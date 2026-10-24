//! C ABI of mumble-speech (specs/design.md §9.2, L4.3–L4.5).
//!
//! Every function returns a status code or a value; no panic crosses the boundary
//! (L4.4). Strings are `(pointer, length)` UTF-8, not NUL-terminated.

#![allow(clippy::missing_safety_doc)] // Safety rules are in the generated header comments.

use mumble_speech as core;
use std::ffi::c_char;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::{ptr, slice};

/// Bumped on every incompatible change of this interface (L4.5).
pub const MUMBLE_ABI_VERSION: u32 = 1;

pub const MUMBLE_OK: i32 = 0;
pub const MUMBLE_ERR_NULL: i32 = -1;
pub const MUMBLE_ERR_UTF8: i32 = -2;
pub const MUMBLE_ERR_VOICE: i32 = -3;
pub const MUMBLE_ERR_SAMPLE_RATE: i32 = -4;
pub const MUMBLE_ERR_INDEX: i32 = -5;
pub const MUMBLE_ERR_PANIC: i32 = -99;

/// Style 0 = beep, 1 = grunt, 2 = alphabet. Pitch −12..12, speed 5..30, variation 0..1.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MumbleVoice {
    pub style: u32,
    pub pitch: f64,
    pub speed: f64,
    pub variation: f64,
    pub seed: u32,
}

/// One sound of a rendered line. `dot_rgb` is 0xRRGGBB; `dot_size` 0 = sm, 1 = md, 2 = lg.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MumbleEvent {
    pub grapheme_index: u32,
    pub utf8_start: u32,
    pub utf8_len: u32,
    pub utf16_start: u32,
    pub utf16_len: u32,
    pub start: f64,
    pub duration: f64,
    pub dot_rgb: u32,
    pub dot_size: u8,
}

/// Result of `mumble_speaker_next`. `samples` stays valid until the next call on the
/// same speaker or until it is freed. `has_dot` is 0 for spaces and pauses.
#[repr(C)]
pub struct MumbleUtterance {
    pub samples: *const f32,
    pub sample_count: usize,
    pub advance: f64,
    pub dot_rgb: u32,
    pub dot_size: u8,
    pub has_dot: u8,
}

/// Opaque rendered line; free with `mumble_render_free`.
pub struct MumbleRender(core::Render);

/// Opaque typewriter speaker; free with `mumble_speaker_free`.
pub struct MumbleSpeaker {
    inner: core::Speaker,
    last: Vec<f32>,
}

fn guard(f: impl FnOnce() -> i32) -> i32 {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or(MUMBLE_ERR_PANIC)
}

fn code(e: core::Error) -> i32 {
    match e {
        core::Error::SampleRateOutOfRange => MUMBLE_ERR_SAMPLE_RATE,
        _ => MUMBLE_ERR_VOICE,
    }
}

unsafe fn voice(v: *const MumbleVoice) -> Result<core::Voice, i32> {
    let v = unsafe { v.as_ref() }.ok_or(MUMBLE_ERR_NULL)?;
    let style = core::StyleId::from_u32(v.style).ok_or(MUMBLE_ERR_VOICE)?;
    Ok(core::Voice { style, pitch: v.pitch, speed: v.speed, variation: v.variation, seed: v.seed })
}

unsafe fn text<'a>(utf8: *const c_char, len: usize) -> Result<&'a str, i32> {
    if len == 0 {
        return Ok("");
    }
    if utf8.is_null() {
        return Err(MUMBLE_ERR_NULL);
    }
    std::str::from_utf8(unsafe { slice::from_raw_parts(utf8.cast::<u8>(), len) }).map_err(|_| MUMBLE_ERR_UTF8)
}

#[unsafe(no_mangle)]
pub extern "C" fn mumble_abi_version() -> u32 {
    MUMBLE_ABI_VERSION
}

/// Renders a whole line. `utf8` may be null when `len` is 0. On success `*out` owns a render.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_render(
    utf8: *const c_char,
    len: usize,
    voice_ptr: *const MumbleVoice,
    sample_rate: u32,
    out: *mut *mut MumbleRender,
) -> i32 {
    guard(|| {
        if out.is_null() {
            return MUMBLE_ERR_NULL;
        }
        let result = (|| {
            let text = unsafe { text(utf8, len) }?;
            let voice = unsafe { voice(voice_ptr) }?;
            core::render(text, &voice, sample_rate).map_err(code)
        })();
        match result {
            Ok(r) => {
                unsafe { *out = Box::into_raw(Box::new(MumbleRender(r))) };
                MUMBLE_OK
            }
            Err(c) => c,
        }
    })
}

/// Mono samples of a render, valid until `mumble_render_free`. Writes their count to `*len`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_render_samples(render: *const MumbleRender, len: *mut usize) -> *const f32 {
    let Some(r) = (unsafe { render.as_ref() }) else {
        return ptr::null();
    };
    if let Some(len) = unsafe { len.as_mut() } {
        *len = r.0.samples.len();
    }
    r.0.samples.as_ptr()
}

/// Seconds: end of the last sound plus a short tail; 0 for a null render.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_render_duration(render: *const MumbleRender) -> f64 {
    unsafe { render.as_ref() }.map_or(0.0, |r| r.0.timeline.duration)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_render_event_count(render: *const MumbleRender) -> usize {
    unsafe { render.as_ref() }.map_or(0, |r| r.0.timeline.events.len())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_render_event(render: *const MumbleRender, index: usize, out: *mut MumbleEvent) -> i32 {
    let (Some(r), Some(out)) = (unsafe { render.as_ref() }, unsafe { out.as_mut() }) else {
        return MUMBLE_ERR_NULL;
    };
    let Some(e) = r.0.timeline.events.get(index) else {
        return MUMBLE_ERR_INDEX;
    };
    *out = MumbleEvent {
        grapheme_index: e.grapheme_index,
        utf8_start: e.utf8_start,
        utf8_len: e.utf8_len,
        utf16_start: e.utf16_start,
        utf16_len: e.utf16_len,
        start: e.start,
        duration: e.duration,
        dot_rgb: e.dot.rgb,
        dot_size: e.dot.size as u8,
    };
    MUMBLE_OK
}

/// Accepts null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_render_free(render: *mut MumbleRender) {
    if !render.is_null() {
        drop(unsafe { Box::from_raw(render) });
    }
}

/// Creates a typewriter speaker. On success `*out` owns it.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_speaker_new(
    voice_ptr: *const MumbleVoice,
    sample_rate: u32,
    out: *mut *mut MumbleSpeaker,
) -> i32 {
    guard(|| {
        if out.is_null() {
            return MUMBLE_ERR_NULL;
        }
        let result = unsafe { voice(voice_ptr) }.and_then(|v| core::Speaker::new(v, sample_rate).map_err(code));
        match result {
            Ok(inner) => {
                unsafe { *out = Box::into_raw(Box::new(MumbleSpeaker { inner, last: Vec::new() })) };
                MUMBLE_OK
            }
            Err(c) => c,
        }
    })
}

/// The sound of `utf8` (usually one character). See `MumbleUtterance` for lifetimes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_speaker_next(
    speaker: *mut MumbleSpeaker,
    utf8: *const c_char,
    len: usize,
    out: *mut MumbleUtterance,
) -> i32 {
    guard(|| {
        let (Some(s), Some(out)) = (unsafe { speaker.as_mut() }, unsafe { out.as_mut() }) else {
            return MUMBLE_ERR_NULL;
        };
        let text = match unsafe { text(utf8, len) } {
            Ok(t) => t,
            Err(c) => return c,
        };
        let u = s.inner.next(text);
        s.last = u.samples;
        *out = MumbleUtterance {
            samples: s.last.as_ptr(),
            sample_count: s.last.len(),
            advance: u.advance,
            dot_rgb: u.dot.map_or(0, |d| d.rgb),
            dot_size: u.dot.map_or(0, |d| d.size as u8),
            has_dot: u8::from(u.dot.is_some()),
        };
        MUMBLE_OK
    })
}

/// Back to the initial state. Accepts null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_speaker_reset(speaker: *mut MumbleSpeaker) {
    if let Some(s) = unsafe { speaker.as_mut() } {
        s.inner.reset();
        s.last.clear();
    }
}

/// Accepts null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_speaker_free(speaker: *mut MumbleSpeaker) {
    if !speaker.is_null() {
        drop(unsafe { Box::from_raw(speaker) });
    }
}

/// Encodes samples as a 16-bit PCM mono WAV file. Free `*out` with `mumble_bytes_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_encode_wav(
    samples: *const f32,
    len: usize,
    sample_rate: u32,
    out: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    guard(|| {
        if out.is_null() || out_len.is_null() || (samples.is_null() && len > 0) {
            return MUMBLE_ERR_NULL;
        }
        let samples = if len == 0 { &[][..] } else { unsafe { slice::from_raw_parts(samples, len) } };
        let bytes = core::encode_wav(samples, sample_rate).into_boxed_slice();
        unsafe {
            *out_len = bytes.len();
            *out = Box::into_raw(bytes).cast::<u8>();
        }
        MUMBLE_OK
    })
}

/// Frees bytes returned by `mumble_encode_wav`. Accepts null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn mumble_bytes_free(bytes: *mut u8, len: usize) {
    if !bytes.is_null() {
        drop(unsafe { Box::from_raw(ptr::slice_from_raw_parts_mut(bytes, len)) });
    }
}
