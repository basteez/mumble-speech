using NUnit.Framework;

namespace MumbleSpeech.Tests
{
    /// <summary>
    /// The conformance vectors on every platform: Test Runner → PlayMode → Run All in Player
    /// (device checklist U7). The EditMode assembly runs the same checks in the editor.
    /// </summary>
    public sealed class PlayerVectorTests
    {
        [Test]
        public void ConformanceVectorsAndErrorCases()
        {
            var failures = VectorChecks.Run();
            Assert.IsEmpty(failures, string.Join("\n", failures));
        }
    }
}
