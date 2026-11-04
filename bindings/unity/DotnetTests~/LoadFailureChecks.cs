// Checks of the native load failure (L4.11, L4.12) that need no native library for the message checks:
// the message for each platform, and the path where the library loads. Compiled with the runtime sources
// (see the csproj), so the internal Native class is visible here.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace MumbleSpeech.Tests
{
    public static class LoadFailureChecks
    {
        // Every message ends with the install options (L4.11).
        private static readonly string[] InstallParts =
        {
            "https://github.com/basteez/mumble-speech.git#upm",
            "openupm add com.mumble-speech.unity",
            "https://mumble-speech.github.io/bindings/unity#from-source",
        };

        /// <summary>Runs every check and returns the failures (empty when all pass).</summary>
        public static List<string> Run()
        {
            var failures = new List<string>();
            CheckMessages(failures);
            CheckLibraryLoads(failures);
            return failures;
        }

        private static void CheckMessages(List<string> failures)
        {
            Check(failures, "Windows x64",
                Native.LoadFailureMessage(OSPlatform.Windows, Architecture.X64),
                new[] { "mumble_ffi.dll", "Plugins/Windows/x86_64/", "Windows x86_64" },
                new[] { "libmumble_ffi", "Plugins/Linux", "Plugins/macOS", "x86_64 libraries only" });

            Check(failures, "macOS arm64",
                Native.LoadFailureMessage(OSPlatform.OSX, Architecture.Arm64),
                new[] { "libmumble_ffi.dylib", "Plugins/macOS/", "macOS arm64" },
                new[] { "mumble_ffi.dll", "Plugins/Windows", "Plugins/Linux", "x86_64 libraries only" });

            Check(failures, "macOS x64",
                Native.LoadFailureMessage(OSPlatform.OSX, Architecture.X64),
                new[] { "libmumble_ffi.dylib", "Plugins/macOS/", "macOS x86_64" },
                new[] { "mumble_ffi.dll", "Plugins/Windows", "Plugins/Linux", "x86_64 libraries only" });

            Check(failures, "Linux x64",
                Native.LoadFailureMessage(OSPlatform.Linux, Architecture.X64),
                new[] { "libmumble_ffi.so", "Plugins/Linux/x86_64/", "Linux x86_64" },
                new[] { "dylib", "mumble_ffi.dll", "Plugins/Windows", "Plugins/macOS", "x86_64 libraries only" });

            // The package ships x86_64 libraries only, so an arm64 process is told so (edge case of L4.11).
            Check(failures, "Windows arm64",
                Native.LoadFailureMessage(OSPlatform.Windows, Architecture.Arm64),
                new[] { "mumble_ffi.dll", "Plugins/Windows/x86_64/", "Windows arm64", "x86_64 libraries only", "arm64 process" },
                new[] { "libmumble_ffi", "Plugins/Linux", "Plugins/macOS" });

            Check(failures, "Linux arm64",
                Native.LoadFailureMessage(OSPlatform.Linux, Architecture.Arm64),
                new[] { "libmumble_ffi.so", "Plugins/Linux/x86_64/", "Linux arm64", "x86_64 libraries only", "arm64 process" },
                new[] { "dylib", "mumble_ffi.dll", "Plugins/Windows", "Plugins/macOS" });

            // Unknown OS: the three folders and the supported platforms are listed instead of one.
            Check(failures, "unknown OS",
                Native.LoadFailureMessage(OSPlatform.Create("FREEBSD"), Architecture.X64),
                new[]
                {
                    "Plugins/Windows/x86_64/", "Plugins/macOS/", "Plugins/Linux/x86_64/",
                    "mumble_ffi.dll", "libmumble_ffi.dylib", "libmumble_ffi.so",
                    "Only Windows, macOS and Linux",
                },
                new[] { "x86_64 libraries only" });
        }

        private static void Check(List<string> failures, string name, string message, string[] required, string[] forbidden)
        {
            foreach (string part in InstallParts)
                if (!message.Contains(part)) failures.Add(name + ": message lacks '" + part + "'");
            foreach (string part in required)
                if (!message.Contains(part)) failures.Add(name + ": message lacks '" + part + "'");
            foreach (string part in forbidden)
                if (message.Contains(part)) failures.Add(name + ": message contains '" + part + "'");
            // No package version in the message: any digit.digit pattern, such as 0.1.1-rc.1, is a failure.
            if (Regex.IsMatch(message, @"\d+\.\d+")) failures.Add(name + ": message contains a version number");
        }

        // Library present: loading succeeds, is remembered, and repeated calls are fine (L4.11, "when the library loads").
        private static void CheckLibraryLoads(List<string> failures)
        {
            try
            {
                Native.EnsureLoaded();
                if (!Native.IsLoaded) failures.Add("IsLoaded is false after EnsureLoaded");
                Native.EnsureLoaded();
                Native.EnsureLoaded();
                if (!Native.IsLoaded) failures.Add("IsLoaded is false after repeated EnsureLoaded");
            }
            catch (Exception e)
            {
                failures.Add("EnsureLoaded threw " + e.GetType().Name + ": " + e.Message);
            }
        }
    }
}
