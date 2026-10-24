// Managed API over the C ABI (specs/design.md §9.4). No UnityEngine dependency.
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace MumbleSpeech
{
    public enum MumbleStyle
    {
        Beep = 0,
        Grunt = 1,
        Alphabet = 2,
    }

    public enum MumbleDotSize
    {
        Small = 0,
        Medium = 1,
        Large = 2,
    }

    /// <summary>Error codes of the C ABI.</summary>
    public enum MumbleErrorCode
    {
        NullArgument = -1,
        InvalidUtf8 = -2,
        VoiceOutOfRange = -3,
        SampleRateOutOfRange = -4,
        IndexOutOfRange = -5,
        Panic = -99,
    }

    public sealed class MumbleException : Exception
    {
        public MumbleErrorCode Code { get; }

        public MumbleException(MumbleErrorCode code) : base("mumble-speech: " + code)
        {
            Code = code;
        }
    }

    /// <summary>Style and voice parameters. Pitch −12..12, speed 5..30, variation 0..1.</summary>
    [Serializable]
    public struct MumbleVoiceSettings
    {
        public MumbleStyle Style;
        public double Pitch;
        public double Speed;
        public double Variation;
        public uint Seed;

        public static MumbleVoiceSettings Default => new MumbleVoiceSettings { Style = MumbleStyle.Beep, Speed = 15.0 };

        internal Native.Voice ToNative()
        {
            return new Native.Voice { Style = (uint)Style, Pitch = Pitch, Speed = Speed, Variation = Variation, Seed = Seed };
        }
    }

    /// <summary>One sound of a rendered line. Indices are UTF-16, so they index C# strings.</summary>
    public readonly struct MumbleEvent
    {
        public readonly int CharIndex;
        public readonly int CharLength;
        public readonly double Start;
        public readonly double Duration;
        public readonly uint ColorRgb;
        public readonly MumbleDotSize DotSize;

        public MumbleEvent(int charIndex, int charLength, double start, double duration, uint colorRgb, MumbleDotSize dotSize)
        {
            CharIndex = charIndex;
            CharLength = charLength;
            Start = start;
            Duration = duration;
            ColorRgb = colorRgb;
            DotSize = dotSize;
        }
    }

    public sealed class MumbleRender
    {
        public float[] Samples;
        public int SampleRate;
        /// <summary>Seconds: end of the last sound plus a short tail.</summary>
        public double Duration;
        public MumbleEvent[] Events;
    }

    public sealed class MumbleUtterance
    {
        /// <summary>Mono samples; empty for spaces and pauses.</summary>
        public float[] Samples;
        /// <summary>Seconds to wait before the next character.</summary>
        public double Advance;
        public bool HasDot;
        public uint ColorRgb;
        public MumbleDotSize DotSize;
    }

    public static class Mumble
    {
        public const int DefaultSampleRate = 48000;

        /// <summary>Version of the native C ABI this package expects.</summary>
        public const uint ExpectedAbiVersion = 1;

        public static uint NativeAbiVersion => Native.mumble_abi_version();

        /// <summary>Audio and events of a whole line.</summary>
        public static MumbleRender Render(string text, MumbleVoiceSettings voice, int sampleRate = DefaultSampleRate)
        {
            byte[] utf8 = Encoding.UTF8.GetBytes(text ?? string.Empty);
            Native.Voice native = voice.ToNative();
            Check(Native.mumble_render(utf8, (UIntPtr)utf8.Length, ref native, (uint)sampleRate, out IntPtr handle));
            try
            {
                IntPtr samplesPtr = Native.mumble_render_samples(handle, out UIntPtr count);
                var samples = new float[(int)count];
                if (samples.Length > 0) Marshal.Copy(samplesPtr, samples, 0, samples.Length);

                var events = new MumbleEvent[(int)Native.mumble_render_event_count(handle)];
                for (int i = 0; i < events.Length; i++)
                {
                    Check(Native.mumble_render_event(handle, (UIntPtr)i, out Native.Event e));
                    events[i] = new MumbleEvent((int)e.Utf16Start, (int)e.Utf16Len, e.Start, e.Duration, e.DotRgb, (MumbleDotSize)e.DotSize);
                }
                return new MumbleRender
                {
                    Samples = samples,
                    SampleRate = sampleRate,
                    Duration = Native.mumble_render_duration(handle),
                    Events = events,
                };
            }
            finally
            {
                Native.mumble_render_free(handle);
            }
        }

        /// <summary>A 16-bit PCM mono WAV file.</summary>
        public static byte[] EncodeWav(float[] samples, int sampleRate)
        {
            samples = samples ?? Array.Empty<float>();
            Check(Native.mumble_encode_wav(samples, (UIntPtr)samples.Length, (uint)sampleRate, out IntPtr bytes, out UIntPtr length));
            try
            {
                var result = new byte[(int)length];
                Marshal.Copy(bytes, result, 0, result.Length);
                return result;
            }
            finally
            {
                Native.mumble_bytes_free(bytes, length);
            }
        }

        internal static void Check(int code)
        {
            if (code != 0) throw new MumbleException((MumbleErrorCode)code);
        }
    }

    /// <summary>
    /// Produces mumble speech one character at a time, for typewriter dialogue. Placing each
    /// utterance at the sum of the previous advances gives exactly the samples of Render.
    /// Owns native memory: dispose it.
    /// </summary>
    public sealed class Speaker : IDisposable
    {
        private IntPtr _handle;

        public int SampleRate { get; }

        public Speaker(MumbleVoiceSettings voice, int sampleRate = Mumble.DefaultSampleRate)
        {
            Native.Voice native = voice.ToNative();
            Mumble.Check(Native.mumble_speaker_new(ref native, (uint)sampleRate, out _handle));
            SampleRate = sampleRate;
        }

        /// <summary>The sound of <paramref name="text"/>, usually one character; several are played in order.</summary>
        public MumbleUtterance Next(string text)
        {
            ThrowIfDisposed();
            byte[] utf8 = Encoding.UTF8.GetBytes(text ?? string.Empty);
            Mumble.Check(Native.mumble_speaker_next(_handle, utf8, (UIntPtr)utf8.Length, out Native.Utterance u));
            var samples = new float[(int)u.SampleCount];
            if (samples.Length > 0) Marshal.Copy(u.Samples, samples, 0, samples.Length);
            return new MumbleUtterance
            {
                Samples = samples,
                Advance = u.Advance,
                HasDot = u.HasDot != 0,
                ColorRgb = u.DotRgb,
                DotSize = (MumbleDotSize)u.DotSize,
            };
        }

        /// <summary>Back to the initial state.</summary>
        public void Reset()
        {
            ThrowIfDisposed();
            Native.mumble_speaker_reset(_handle);
        }

        public void Dispose()
        {
            if (_handle != IntPtr.Zero)
            {
                Native.mumble_speaker_free(_handle);
                _handle = IntPtr.Zero;
            }
            GC.SuppressFinalize(this);
        }

        ~Speaker()
        {
            if (_handle != IntPtr.Zero) Native.mumble_speaker_free(_handle);
        }

        private void ThrowIfDisposed()
        {
            if (_handle == IntPtr.Zero) throw new ObjectDisposedException(nameof(Speaker));
        }
    }
}
