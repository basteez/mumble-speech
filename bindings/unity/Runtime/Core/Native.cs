// P/Invoke declarations over the C ABI (bindings/c/include/mumble.h, specs/design.md §9.2).
// Struct layouts must match the header field by field.
using System;
using System.Runtime.InteropServices;

namespace MumbleSpeech
{
    internal static class Native
    {
        private const string Lib = "mumble_ffi";

        [StructLayout(LayoutKind.Sequential)]
        internal struct Voice
        {
            public uint Style;
            public double Pitch;
            public double Speed;
            public double Variation;
            public uint Seed;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Event
        {
            public uint GraphemeIndex;
            public uint Utf8Start;
            public uint Utf8Len;
            public uint Utf16Start;
            public uint Utf16Len;
            public double Start;
            public double Duration;
            public uint DotRgb;
            public byte DotSize;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Utterance
        {
            public IntPtr Samples;
            public UIntPtr SampleCount;
            public double Advance;
            public uint DotRgb;
            public byte DotSize;
            public byte HasDot;
        }

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern uint mumble_abi_version();

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int mumble_render(byte[] utf8, UIntPtr len, ref Voice voice, uint sampleRate, out IntPtr render);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern IntPtr mumble_render_samples(IntPtr render, out UIntPtr len);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern double mumble_render_duration(IntPtr render);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern UIntPtr mumble_render_event_count(IntPtr render);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int mumble_render_event(IntPtr render, UIntPtr index, out Event e);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void mumble_render_free(IntPtr render);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int mumble_speaker_new(ref Voice voice, uint sampleRate, out IntPtr speaker);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int mumble_speaker_next(IntPtr speaker, byte[] utf8, UIntPtr len, out Utterance utterance);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void mumble_speaker_reset(IntPtr speaker);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void mumble_speaker_free(IntPtr speaker);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern int mumble_encode_wav(float[] samples, UIntPtr len, uint sampleRate, out IntPtr bytes, out UIntPtr bytesLen);

        [DllImport(Lib, CallingConvention = CallingConvention.Cdecl)]
        internal static extern void mumble_bytes_free(IntPtr bytes, UIntPtr len);
    }
}
