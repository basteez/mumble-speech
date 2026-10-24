using System;
using MumbleSpeech.Tests;

internal static class Program
{
    private static int Main()
    {
        var failures = VectorChecks.Run();
        foreach (string f in failures) Console.Error.WriteLine("FAIL: " + f);
        if (failures.Count > 0) return 1;
        Console.WriteLine($"{Vectors.All.Length} vectors and error cases passed through the C# interop layer");
        return 0;
    }
}
