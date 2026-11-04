using System;
using System.Collections.Generic;
using MumbleSpeech;
using MumbleSpeech.Tests;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--expect-load-failure") >= 0) return ExpectLoadFailure();

        var failures = LoadFailureChecks.Run();
        failures.AddRange(VectorChecks.Run());
        foreach (string f in failures) Console.Error.WriteLine("FAIL: " + f);
        if (failures.Count > 0) return 1;
        Console.WriteLine($"{Vectors.All.Length} vectors and error cases passed through the C# interop layer");
        return 0;
    }

    // Second CI run, with no native library on the search path: every entry point must report
    // the missing library with the same exception type, an inner exception and the install help (L4.11).
    private static int ExpectLoadFailure()
    {
        var failures = new List<string>();
        var entryPoints = new List<KeyValuePair<string, Action>>
        {
            new KeyValuePair<string, Action>("Mumble.Render", () => Mumble.Render("Hello", MumbleVoiceSettings.Default)),
            new KeyValuePair<string, Action>("Mumble.EncodeWav", () => Mumble.EncodeWav(new float[] { 0f }, Mumble.DefaultSampleRate)),
            new KeyValuePair<string, Action>("Mumble.NativeAbiVersion", () => { _ = Mumble.NativeAbiVersion; }),
            new KeyValuePair<string, Action>("new Speaker", () => new Speaker(MumbleVoiceSettings.Default)),
        };
        string[] expected =
        {
            "libmumble_ffi.so",
            "Plugins/Linux/x86_64/",
            "#upm",
            "openupm add com.mumble-speech.unity",
            "https://mumble-speech.github.io/bindings/unity#from-source",
        };
        // Twice each: a failure must not be remembered as a success, nor stop being reported.
        for (int attempt = 1; attempt <= 2; attempt++)
        {
            foreach (KeyValuePair<string, Action> entry in entryPoints)
            {
                string name = entry.Key + " (call " + attempt + ")";
                try
                {
                    entry.Value();
                    failures.Add(name + ": did not throw");
                }
                catch (DllNotFoundException e)
                {
                    if (e.InnerException == null || e.InnerException.GetType() != typeof(DllNotFoundException))
                        failures.Add(name + ": inner exception missing or of another type");
                    foreach (string part in expected)
                        if (!e.Message.Contains(part)) failures.Add(name + ": message lacks '" + part + "'");
                }
                catch (Exception e)
                {
                    failures.Add(name + ": threw " + e.GetType().Name + " instead of DllNotFoundException");
                }
            }
        }
        // Failures are not remembered as a load: the library is still not loaded (L4.11).
        if (Native.IsLoaded) failures.Add("IsLoaded is true although the library is missing");
        foreach (string f in failures) Console.Error.WriteLine("FAIL: " + f);
        if (failures.Count > 0) return 1;
        Console.WriteLine("every entry point reports the missing native library with an actionable message");
        return 0;
    }
}
