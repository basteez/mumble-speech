// P/Invoke declarations over the C ABI (bindings/c/include/mumble.h, specs/design.md §9.2).
// Struct layouts must match the header field by field.
using System;
using System.Runtime.InteropServices;

namespace MumbleSpeech
{
    internal static class Native
    {
        private const string Lib = "mumble_ffi";

        private const string InstallHelp =
            "Install the package with its native libraries: Package Manager > Add package from git URL >\n" +
            "https://github.com/basteez/mumble-speech.git#upm (or OpenUPM:\n" +
            "openupm add com.mumble-speech.unity, or the tarball of a GitHub release).\n" +
            "To build it from source: https://mumble-speech.github.io/bindings/unity#from-source";

        private static bool _loaded;

        /// <summary>True once the native library has been loaded successfully (specs/design.md §9.4, LD19).</summary>
        internal static bool IsLoaded => _loaded;

        /// <summary>
        /// Loads the native library by calling <c>mumble_abi_version</c>. If the runtime cannot load it,
        /// throws an exception of the same type with the original as inner exception and an actionable
        /// message (L4.11). Success is remembered; failure is not, so every call reports it.
        /// </summary>
        internal static void EnsureLoaded()
        {
            if (_loaded) return;
            try
            {
                mumble_abi_version();
            }
            catch (DllNotFoundException e)
            {
                throw new DllNotFoundException(CurrentLoadFailureMessage(), e);
            }
            catch (EntryPointNotFoundException e)
            {
                throw new EntryPointNotFoundException(CurrentLoadFailureMessage(), e);
            }
            catch (BadImageFormatException e)
            {
                throw new BadImageFormatException(CurrentLoadFailureMessage(), e);
            }
            _loaded = true;
        }

        private static string CurrentLoadFailureMessage()
        {
            OSPlatform os = OSPlatform.Create("UNKNOWN");
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) os = OSPlatform.Windows;
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) os = OSPlatform.OSX;
            else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) os = OSPlatform.Linux;
            return LoadFailureMessage(os, RuntimeInformation.ProcessArchitecture);
        }

        /// <summary>
        /// The message of the exception thrown when the library cannot be loaded. A pure function of the
        /// platform, so it can be checked on any OS (L4.11).
        /// </summary>
        internal static string LoadFailureMessage(OSPlatform os, Architecture architecture)
        {
            string arch = ArchitectureName(architecture);
            string file;
            string folder;
            string label;
            if (os == OSPlatform.Windows)
            {
                file = "mumble_ffi.dll";
                folder = "Plugins/Windows/x86_64/";
                label = "Windows " + arch;
            }
            else if (os == OSPlatform.OSX)
            {
                file = "libmumble_ffi.dylib";
                folder = "Plugins/macOS/";
                label = "macOS " + arch;
            }
            else if (os == OSPlatform.Linux)
            {
                file = "libmumble_ffi.so";
                folder = "Plugins/Linux/x86_64/";
                label = "Linux " + arch;
            }
            else
            {
                return "mumble-speech: cannot load the native library on this platform.\n" +
                    "Only Windows, macOS and Linux desktop are supported. The package expects the library in\n" +
                    "Plugins/Windows/x86_64/ (mumble_ffi.dll), Plugins/macOS/ (libmumble_ffi.dylib) or\n" +
                    "Plugins/Linux/x86_64/ (libmumble_ffi.so) inside the package.\n" +
                    InstallHelp;
            }

            string message = "mumble-speech: cannot load the native library " + file + " (" + label + ").\n" +
                "It belongs in " + folder + " inside the package. A source checkout of\n" +
                "bindings/unity does not contain it.\n";
            if (os != OSPlatform.OSX && architecture != Architecture.X64)
            {
                message += "The package provides x86_64 libraries only, so this " + arch + " process cannot load them.\n";
            }
            return message + InstallHelp;
        }

        private static string ArchitectureName(Architecture architecture)
        {
            switch (architecture)
            {
                case Architecture.X64: return "x86_64";
                case Architecture.X86: return "x86";
                case Architecture.Arm64: return "arm64";
                case Architecture.Arm: return "arm";
                default: return architecture.ToString().ToLowerInvariant();
            }
        }

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
            public uint Style;
            public byte Variant;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct Utterance
        {
            public IntPtr Samples;
            public UIntPtr SampleCount;
            public double Advance;
            public uint Style;
            public byte Variant;
            public byte HasSound;
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
