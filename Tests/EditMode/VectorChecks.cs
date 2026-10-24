// Conformance checks shared by the Unity EditMode tests and the .NET CI job (LD13).
// Public API of MumbleSpeech.Core only; no NUnit, no UnityEngine.
using System;
using System.Collections.Generic;

namespace MumbleSpeech.Tests
{
    public static class VectorChecks
    {
        /// <summary>Runs every check and returns the failures (empty when all pass).</summary>
        public static List<string> Run()
        {
            var failures = new List<string>();
            if (Mumble.NativeAbiVersion != Mumble.ExpectedAbiVersion)
                failures.Add($"native ABI version {Mumble.NativeAbiVersion}, expected {Mumble.ExpectedAbiVersion}");
            foreach (Vector v in Vectors.All) CheckVector(v, failures);
            CheckErrors(failures);
            return failures;
        }

        /// <summary>64-bit FNV-1a over the little-endian bytes of the samples (LD7).</summary>
        public static ulong PcmHash(float[] samples)
        {
            var bytes = new byte[samples.Length * sizeof(float)];
            Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
            if (!BitConverter.IsLittleEndian) throw new PlatformNotSupportedException("big-endian host");
            ulong hash = 0xcbf29ce484222325ul;
            foreach (byte b in bytes)
            {
                hash ^= b;
                hash *= 0x100000001b3ul;
            }
            return hash;
        }

        private static MumbleVoiceSettings Voice(Vector v)
        {
            return new MumbleVoiceSettings
            {
                Style = (MumbleStyle)v.Style,
                Pitch = v.Pitch,
                Speed = v.Speed,
                Variation = v.Variation,
                Seed = v.Seed,
            };
        }

        private static void CheckVector(Vector v, List<string> failures)
        {
            MumbleRender r;
            try
            {
                r = Mumble.Render(v.Text, Voice(v), v.SampleRate);
            }
            catch (MumbleException e)
            {
                if ((int)e.Code != v.Error) failures.Add($"{v.Id}: unexpected error {e.Code}");
                return;
            }
            if (v.Error != 0)
            {
                failures.Add($"{v.Id}: expected error {v.Error}, got none");
                return;
            }
            if (r.Samples.Length != v.SampleCount) failures.Add($"{v.Id}: {r.Samples.Length} samples, expected {v.SampleCount}");
            ulong hash = PcmHash(r.Samples);
            if (hash != v.PcmHash) failures.Add($"{v.Id}: PCM hash 0x{hash:x16}, expected 0x{v.PcmHash:x16}");
            if (r.Duration != v.Duration) failures.Add($"{v.Id}: duration {r.Duration:R}, expected {v.Duration:R}");
            if (r.Events.Length != v.Events.Length)
            {
                failures.Add($"{v.Id}: {r.Events.Length} events, expected {v.Events.Length}");
                return;
            }
            for (int i = 0; i < r.Events.Length; i++)
            {
                MumbleEvent got = r.Events[i];
                VectorEvent want = v.Events[i];
                if (got.CharIndex != want.Utf16Start || got.CharLength != want.Utf16Length)
                    failures.Add($"{v.Id}[{i}]: UTF-16 range {got.CharIndex}+{got.CharLength}, expected {want.Utf16Start}+{want.Utf16Length}");
                if (got.Start != want.Start || got.Duration != want.Duration)
                    failures.Add($"{v.Id}[{i}]: timing {got.Start:R}/{got.Duration:R}, expected {want.Start:R}/{want.Duration:R}");
                if ((int)got.Style != v.Style || got.Variant != want.Variant)
                    failures.Add($"{v.Id}[{i}]: sound {got.Style}/{got.Variant}, expected {v.Style}/{want.Variant}");
            }

            // The whole text through one Speaker.Next places sounds exactly like Render (L3.2, L3.3).
            using (var speaker = new Speaker(Voice(v), v.SampleRate))
            {
                MumbleUtterance u = speaker.Next(v.Text);
                if (u.Samples.Length > r.Samples.Length)
                {
                    failures.Add($"{v.Id}: speaker longer than render");
                }
                else
                {
                    for (int i = 0; i < r.Samples.Length; i++)
                    {
                        float expected = i < u.Samples.Length ? u.Samples[i] : 0f;
                        if (BitConverter.SingleToInt32Bits(r.Samples[i]) != BitConverter.SingleToInt32Bits(expected))
                        {
                            failures.Add($"{v.Id}: speaker sample {i} differs from render");
                            break;
                        }
                    }
                }
                if (u.HasSound != (v.Events.Length > 0)) failures.Add($"{v.Id}: HasSound");
            }
        }

        private static void CheckErrors(List<string> failures)
        {
            void Expect(MumbleErrorCode code, Action action, string what)
            {
                try
                {
                    action();
                    failures.Add($"{what}: no error");
                }
                catch (MumbleException e) when (e.Code == code)
                {
                }
                catch (Exception e)
                {
                    failures.Add($"{what}: {e.GetType().Name} {e.Message}");
                }
            }

            Expect(MumbleErrorCode.VoiceOutOfRange, () => Mumble.Render("a", new MumbleVoiceSettings { Style = (MumbleStyle)7, Speed = 15 }), "unknown style");
            Expect(MumbleErrorCode.SampleRateOutOfRange, () => new Speaker(MumbleVoiceSettings.Default, 7999), "speaker sample rate");

            using (var speaker = new Speaker(MumbleVoiceSettings.Default))
            {
                MumbleUtterance pause = speaker.Next(".");
                if (pause.Samples.Length != 0 || pause.HasSound || Math.Abs(pause.Advance - 4.0 / 15.0) > 1e-12)
                    failures.Add("pause utterance");
                MumbleUtterance first = speaker.Next("a");
                speaker.Reset();
                speaker.Next(".");
                MumbleUtterance again = speaker.Next("a");
                if (first.Samples.Length != again.Samples.Length || first.Variant != again.Variant) failures.Add("reset");
            }

            byte[] wav = Mumble.EncodeWav(new[] { 0f, 0.5f, -0.5f }, 44100);
            if (wav.Length != 44 + 6 || wav[0] != (byte)'R' || wav[3] != (byte)'F') failures.Add("WAV header");

            string text = "è👋 a";
            MumbleRender r = Mumble.Render(text, MumbleVoiceSettings.Default);
            var chars = new List<string>();
            foreach (MumbleEvent e in r.Events) chars.Add(text.Substring(e.CharIndex, e.CharLength));
            if (string.Join("|", chars) != "è|👋|a") failures.Add("UTF-16 indices: " + string.Join("|", chars));
        }
    }
}
