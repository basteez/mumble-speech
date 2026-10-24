using System;
using UnityEngine;
using UnityEngine.Events;

namespace MumbleSpeech
{
    /// <summary>
    /// Speaks lines or single characters through the AudioSource on the same GameObject.
    /// Audio is generated at runtime; nothing is drawn.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public sealed class MumbleSpeaker : MonoBehaviour
    {
        [Serializable]
        public sealed class CharacterEvent : UnityEvent<int> { }

        [Tooltip("Leave empty for the default voice.")]
        public MumbleVoice voice;

        [Tooltip("Invoked with the UTF-16 index of each character when its sound is heard (Say only).")]
        public CharacterEvent onCharacter = new CharacterEvent();

        [Tooltip("Invoked when a line started with Say has been heard to the end.")]
        public UnityEvent onFinished = new UnityEvent();

        private AudioSource _source;
        private AudioClip _clip;
        private Speaker _typewriter;
        private MumbleEvent[] _events = Array.Empty<MumbleEvent>();
        private int _nextEvent;
        private double _dspStart;
        private double _duration;

        public bool IsSpeaking { get; private set; }

        private MumbleVoiceSettings Settings => voice != null ? voice.Settings : MumbleVoiceSettings.Default;

        private void Awake()
        {
            _source = GetComponent<AudioSource>();
            _source.playOnAwake = false;
        }

        /// <summary>Renders and plays a whole line.</summary>
        public void Say(string text)
        {
            Stop();
            int sampleRate = AudioSettings.outputSampleRate;
            MumbleRender render = Mumble.Render(text, Settings, sampleRate);
            _events = render.Events;
            _nextEvent = 0;
            _duration = render.Duration;
            // Scheduling slightly ahead makes dspTime an exact reference for the events.
            _dspStart = AudioSettings.dspTime + 0.05;
            Play(render.Samples, sampleRate, _dspStart);
            IsSpeaking = true;
        }

        /// <summary>
        /// Plays the sound of one character (typewriter mode) and returns the seconds to wait before
        /// the next one. Characters of a line go through the same speaker in order; call
        /// ResetSpeaker before a new line.
        /// </summary>
        public float SpeakCharacter(string text)
        {
            if (_typewriter == null) _typewriter = new Speaker(Settings, AudioSettings.outputSampleRate);
            MumbleUtterance u = _typewriter.Next(text);
            if (u.Samples.Length > 0) Play(u.Samples, _typewriter.SampleRate, 0);
            return (float)u.Advance;
        }

        /// <summary>Starts the next SpeakCharacter sequence from the voice's initial state.</summary>
        public void ResetSpeaker()
        {
            _typewriter?.Dispose();
            _typewriter = null;
        }

        public void Stop()
        {
            IsSpeaking = false;
            if (_source != null) _source.Stop();
        }

        private void Update()
        {
            if (!IsSpeaking) return;
            double position = AudioSettings.dspTime - _dspStart;
            while (_nextEvent < _events.Length && _events[_nextEvent].Start <= position)
            {
                onCharacter.Invoke(_events[_nextEvent].CharIndex);
                _nextEvent++;
            }
            if (position >= _duration)
            {
                IsSpeaking = false;
                onFinished.Invoke();
            }
        }

        private void Play(float[] samples, int sampleRate, double dspTime)
        {
            _source.Stop();
            if (_clip != null) Destroy(_clip);
            _clip = AudioClip.Create("Mumble", Mathf.Max(1, samples.Length), 1, sampleRate, false);
            if (samples.Length > 0) _clip.SetData(samples, 0);
            _source.clip = _clip;
            if (dspTime > 0) _source.PlayScheduled(dspTime);
            else _source.Play();
        }

        private void OnDestroy()
        {
            ResetSpeaker();
            if (_clip != null) Destroy(_clip);
        }
    }
}
