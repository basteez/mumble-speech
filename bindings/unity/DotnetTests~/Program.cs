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
        CheckSpeakerRate(failures);
        foreach (string f in failures) Console.Error.WriteLine("FAIL: " + f);
        if (failures.Count > 0) return 1;
        Console.WriteLine($"{Vectors.All.Length} vectors and error cases passed through the C# interop layer");
        Console.WriteLine("speaker rate checks passed (48 kHz whatever the output rate, L4.10)");
        return 0;
    }

    // The speakers synthesize at Mumble.SpeakerSampleRate, a constant: no device rate is involved (LD17).
    private static void CheckSpeakerRate(List<string> failures)
    {
        // Not const: a constant condition below would be CS0162 (unreachable code), an error here.
        int rate = Mumble.SpeakerSampleRate;
        if (rate != 48000) failures.Add($"SpeakerSampleRate is {rate}, expected 48000");
        MumbleVoiceSettings voice = MumbleVoiceSettings.Default;

        // Hello with the default voice: 16,800 samples, the PCM of conformance vector beep-01.
        MumbleRender hello = Mumble.Render("Hello", voice, rate);
        if (hello.SampleRate != rate) failures.Add($"Hello: SampleRate {hello.SampleRate}, expected {rate}");
        if (hello.Samples.Length != 16800) failures.Add($"Hello at SpeakerSampleRate: {hello.Samples.Length} samples, expected 16800");
        if (VectorChecks.PcmHash(hello.Samples) != 0x773a75ba3a8ba232ul) failures.Add("Hello at SpeakerSampleRate: PCM hash differs from vector beep-01");

        // Two renders at the constant rate are identical.
        MumbleRender again = Mumble.Render("Hello", voice, rate);
        if (VectorChecks.PcmHash(again.Samples) != VectorChecks.PcmHash(hello.Samples) || again.Duration != hello.Duration)
            failures.Add("Hello: two renders at SpeakerSampleRate differ");

        // Empty text: nothing to play.
        MumbleRender empty = Mumble.Render("", voice, rate);
        if (empty.Samples.Length != 0 || empty.Events.Length != 0 || empty.Duration != 0.0)
            failures.Add("empty text at SpeakerSampleRate is not an empty render");

        // A line of about 1,000 characters: one sample per 1/48000 s of the line, up to the tail.
        string longText = "";
        for (int i = 0; i < 50; i++) longText += "Hello there, friend. ";
        voice.Speed = 30.0;
        MumbleRender longLine = Mumble.Render(longText, voice, rate);
        if (longLine.Events.Length == 0) failures.Add("long line: no events");
        if (longLine.Samples.Length != (int)Math.Ceiling(longLine.Duration * rate))
            failures.Add($"long line: {longLine.Samples.Length} samples, expected ceil(duration x {rate})");

        // The typewriter speaker at the same rate: one letter at speed 15 advances 1 / speed.
        using (var typewriter = new Speaker(MumbleVoiceSettings.Default, rate))
        {
            MumbleUtterance h = typewriter.Next("H");
            if (typewriter.SampleRate != rate) failures.Add($"typewriter SampleRate {typewriter.SampleRate}, expected {rate}");
            if (Math.Abs(h.Advance - 1.0 / 15.0) > 1e-12) failures.Add($"typewriter advance {h.Advance:R}, expected 1/15");
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
