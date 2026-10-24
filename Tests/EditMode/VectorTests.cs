using NUnit.Framework;

namespace MumbleSpeech.Tests
{
    public sealed class VectorTests
    {
        [Test]
        public void ConformanceVectorsAndErrorCases()
        {
            var failures = VectorChecks.Run();
            Assert.IsEmpty(failures, string.Join("\n", failures));
        }
    }
}
