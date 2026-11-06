use crate::audio::{char_index, stream};
use crate::voice::{core_voice, error_name, MumbleVoice};
use godot::classes::{AudioServer, AudioStreamPlayer, AudioStreamWav, INode, Os, ProjectSettings, Time};
use godot::prelude::*;
use mumble_speech as core;

/// Speaks lines or single characters through an internal `AudioStreamPlayer`.
#[derive(GodotClass)]
#[class(base = Node)]
pub struct MumbleSpeaker {
    #[export]
    voice: Option<Gd<MumbleVoice>>,
    #[export]
    bus: StringName,
    #[export(range = (-80.0, 24.0, 0.1))]
    volume_db: f64,
    player: Option<Gd<AudioStreamPlayer>>,
    /// Typewriter state, created lazily and reset per line.
    typewriter: Option<core::Speaker>,
    /// `(start seconds, char index)` of the line being said.
    events: Vec<(f64, i64)>,
    next_event: usize,
    duration: f64,
    speaking: bool,
    /// Set by `say`: the line's position is the wall clock since `started_usec` instead of the
    /// audio clock (web export in Sample playback mode, LD30).
    wall_clock: bool,
    /// `Time.get_ticks_usec()` when `say` started the player.
    started_usec: u64,
    base: Base<Node>,
}

#[godot_api]
impl INode for MumbleSpeaker {
    fn init(base: Base<Node>) -> Self {
        Self {
            voice: None,
            bus: "Master".into(),
            volume_db: 0.0,
            player: None,
            typewriter: None,
            events: Vec::new(),
            next_event: 0,
            duration: 0.0,
            speaking: false,
            wall_clock: false,
            started_usec: 0,
            base,
        }
    }

    /// Stops the voice when leaving the tree, so the AudioServer drops the playback right away.
    fn exit_tree(&mut self) {
        self.stop();
    }

    fn process(&mut self, _delta: f64) {
        if !self.speaking {
            return;
        }
        let position = self.position();
        while let Some(&(start, index)) = self.events.get(self.next_event) {
            if start > position {
                break;
            }
            self.next_event += 1;
            self.signals().character_spoken().emit(index);
        }
        if position >= self.duration {
            self.speaking = false;
            self.signals().finished().emit();
        }
    }
}

#[godot_api]
impl MumbleSpeaker {
    /// The rate every line and character is synthesized at, whatever the output rate of the
    /// engine: Godot resamples the stream on playback (L4.10).
    #[constant]
    pub const SAMPLE_RATE: i64 = 48_000;

    /// Emitted when the sound of the character at `char_index` is heard.
    #[signal]
    pub fn character_spoken(char_index: i64);

    /// Emitted when a line started with `say` has been heard to the end.
    #[signal]
    pub fn finished();

    /// Renders and plays a whole line.
    #[func]
    pub fn say(&mut self, text: GString) {
        let text = text.to_string();
        let sample_rate = Self::RATE;
        let render = match core::render(&text, &core_voice(&self.voice), sample_rate) {
            Ok(r) => r,
            Err(e) => {
                godot_error!("MumbleSpeaker.say: {}", error_name(e));
                return;
            }
        };
        self.events = render.timeline.events.iter().map(|e| (e.start, char_index(&text, e.utf8_start))).collect();
        self.next_event = 0;
        self.duration = render.timeline.duration;
        if render.samples.is_empty() {
            // Nothing to play: Web Audio rejects a zero-length buffer (L4.16). The line still
            // replaces the previous one, and with no sound playing the audio clock describes
            // nothing, so the signals follow the wall clock and `finished` still arrives.
            if let Some(player) = self.player.as_mut() {
                player.stop();
            }
            self.wall_clock = true;
        } else {
            self.play(stream(&render.samples, sample_rate));
            self.wall_clock = self.uses_wall_clock();
        }
        self.started_usec = Time::singleton().get_ticks_usec();
        self.speaking = true;
    }

    /// Plays the sound of one character (typewriter mode) and returns the seconds to
    /// wait before the next one. Characters of a line must go through the same speaker
    /// in order; call `reset()` before a new line.
    #[func]
    pub fn speak_character(&mut self, text: GString) -> f64 {
        let sample_rate = Self::RATE;
        if self.typewriter.is_none() {
            match core::Speaker::new(core_voice(&self.voice), sample_rate) {
                Ok(s) => self.typewriter = Some(s),
                Err(e) => {
                    godot_error!("MumbleSpeaker.speak_character: {}", error_name(e));
                    return 0.0;
                }
            }
        }
        let utterance = self.typewriter.as_mut().expect("created above").next(&text.to_string());
        if !utterance.samples.is_empty() {
            self.play(stream(&utterance.samples, sample_rate));
        }
        utterance.advance
    }

    /// Starts the next `speak_character` sequence from the voice's initial state.
    #[func]
    pub fn reset(&mut self) {
        self.typewriter = None;
    }

    #[func]
    pub fn stop(&mut self) {
        self.speaking = false;
        if let Some(player) = self.player.as_mut() {
            player.stop();
        }
    }

    #[func]
    pub fn is_speaking(&self) -> bool {
        self.speaking
    }

    /// The line as a 16-bit stream at `SAMPLE_RATE`, to play or save yourself. The stream can be
    /// empty (0 frames: empty text, or text with nothing to say); do not play an empty stream on
    /// the web, where Web Audio rejects a zero-length buffer (`say` does not play one).
    #[func]
    pub fn render_stream(&self, text: GString) -> Option<Gd<AudioStreamWav>> {
        let sample_rate = Self::RATE;
        match core::render(&text.to_string(), &core_voice(&self.voice), sample_rate) {
            Ok(r) => Some(stream(&r.samples, sample_rate)),
            Err(e) => {
                godot_error!("MumbleSpeaker.render_stream: {}", error_name(e));
                None
            }
        }
    }
}

impl MumbleSpeaker {
    const RATE: u32 = Self::SAMPLE_RATE as u32;

    fn play(&mut self, stream: Gd<AudioStreamWav>) {
        let bus = self.bus.clone();
        let volume = self.volume_db as f32;
        let mut player = match self.player.clone() {
            Some(p) => p,
            None => {
                let p = AudioStreamPlayer::new_alloc();
                self.base_mut().add_child(&p);
                self.player = Some(p.clone());
                p
            }
        };
        player.set_bus(&bus);
        player.set_volume_db(volume);
        player.set_stream(&stream);
        player.play();
    }

    /// Whether the line's position is the wall clock (LD30, L4.16): on the web the engine mixer's
    /// clock does not describe a stream played in Sample mode (the browser plays it), and it
    /// stops while the `AudioContext` is suspended, so the signals follow the time since `say`.
    /// Desktop and web Stream mode keep the audio clock.
    fn uses_wall_clock(&self) -> bool {
        let is_web = Os::singleton().has_feature(&GString::from("web"));
        let Some(player) = self.player.as_ref() else {
            return false;
        };
        let player_type = i64::from(player.get_playback_type().ord());
        // The project setting: 0 Stream, 1 Sample. `get_setting_with_override`, as the
        // AudioServer reads it: plain `get_setting` ignores the `.web` override, which is
        // what makes Sample the web default. A value that is not an integer reads as -1,
        // which `wall_clock_for` treats as the audio clock.
        let default_type = ProjectSettings::singleton()
            .get_setting_with_override(&StringName::from("audio/general/default_playback_type"))
            .try_to::<i64>()
            .unwrap_or(-1);
        wall_clock_for(is_web, player_type, default_type)
    }

    /// Seconds of the current line heard so far: the wall clock when `wall_clock` is set,
    /// otherwise the audio clock, latency-compensated; infinite once the player has stopped at
    /// the end of its stream.
    fn position(&self) -> f64 {
        if self.wall_clock {
            let now = Time::singleton().get_ticks_usec();
            return now.saturating_sub(self.started_usec) as f64 / 1_000_000.0;
        }
        let Some(player) = self.player.as_ref() else {
            return 0.0;
        };
        if self.speaking && !player.is_playing() {
            // The stream has played to its end and the player stopped, which resets its playback
            // position: the line was heard to the end. The latency-compensated clock may never
            // reach the duration (large output latency on the web, LD30), so `process` still
            // gets every remaining character and `finished`. `is_playing` is true from the
            // `play` in `say` on, and `stop` clears `speaking` first.
            return f64::INFINITY;
        }
        let server = AudioServer::singleton();
        player.get_playback_position() as f64 + server.get_time_since_last_mix() - server.get_output_latency()
    }
}

/// The clock choice of `uses_wall_clock` as a pure function (LD30, L4.16), so it can be tested
/// without Godot. `player_type` is `AudioServer.PlaybackType` of the player (0 default, 1 stream,
/// 2 sample); `default_type` is the project setting `audio/general/default_playback_type`
/// (0 Stream, 1 Sample). Only the web in Sample mode uses the wall clock; any other or unknown
/// value keeps the audio clock.
fn wall_clock_for(is_web: bool, player_type: i64, default_type: i64) -> bool {
    if !is_web {
        return false;
    }
    match player_type {
        2 => true,
        0 => default_type == 1,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT: i64 = 0;
    const STREAM: i64 = 1;
    const SAMPLE: i64 = 2;

    #[test]
    fn desktop_never_uses_the_wall_clock() {
        for player in [DEFAULT, STREAM, SAMPLE, -1, 3, i64::MAX, i64::MIN] {
            for default in [0, 1, 2, -1, i64::MAX] {
                assert!(!wall_clock_for(false, player, default), "player {player}, default {default}");
            }
        }
    }

    #[test]
    fn web_sample_uses_the_wall_clock() {
        for default in [0, 1] {
            assert!(wall_clock_for(true, SAMPLE, default));
        }
    }

    #[test]
    fn web_stream_keeps_the_audio_clock() {
        for default in [0, 1] {
            assert!(!wall_clock_for(true, STREAM, default));
        }
    }

    #[test]
    fn web_default_follows_the_project_setting() {
        assert!(!wall_clock_for(true, DEFAULT, 0), "project default Stream");
        assert!(wall_clock_for(true, DEFAULT, 1), "project default Sample");
    }

    #[test]
    fn unknown_values_fall_back_to_the_audio_clock() {
        for player in [-1, 3, 4, 100, i64::MAX, i64::MIN] {
            assert!(!wall_clock_for(true, player, 1), "player {player}");
        }
        for default in [-1, 2, 3, i64::MAX, i64::MIN] {
            assert!(!wall_clock_for(true, DEFAULT, default), "default {default}");
        }
    }
}
