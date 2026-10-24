using UnityEngine;

namespace MumbleSpeech
{
    /// <summary>Style and voice parameters, editable in the inspector.</summary>
    [CreateAssetMenu(fileName = "MumbleVoice", menuName = "Mumble Speech/Voice")]
    public sealed class MumbleVoice : ScriptableObject
    {
        [Tooltip("Beep (Undertale), Grunt (Banjo-Kazooie) or Alphabet (Animal Crossing).")]
        public MumbleStyle style = MumbleStyle.Beep;

        [Range(-12f, 12f), Tooltip("Semitones.")]
        public float pitch;

        [Range(5f, 30f), Tooltip("Characters per second.")]
        public float speed = 15f;

        [Range(0f, 1f), Tooltip("Random pitch deviation.")]
        public float variation;

        [Min(0), Tooltip("Random seed; use e.g. a line id to vary identical lines.")]
        public int seed;

        public MumbleVoiceSettings Settings => new MumbleVoiceSettings
        {
            Style = style,
            Pitch = pitch,
            Speed = speed,
            Variation = variation,
            Seed = (uint)Mathf.Max(0, seed),
        };
    }
}
