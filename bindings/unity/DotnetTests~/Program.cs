using System;
using System.Collections.Generic;
using MumbleSpeech;
using MumbleSpeech.Tests;

internal static class Program
{
    private static int Main()
    {
        var failures = VectorChecks.Run();
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
    }
}
