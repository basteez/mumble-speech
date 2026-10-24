using System.Collections.Generic;
using System.Globalization;
using TMPro;
using UnityEngine;
using UnityEngine.Events;

namespace MumbleSpeech
{
    /// <summary>
    /// Reveals a TextMeshPro text one character at a time, in sync with a MumbleSpeaker.
    /// Compiled only when TextMeshPro is in the project. Expects plain text (no rich-text tags).
    /// </summary>
    public sealed class MumbleTypewriterTMP : MonoBehaviour
    {
        public TMP_Text label;
        public MumbleSpeaker speaker;
        public UnityEvent onFinished = new UnityEvent();

        private readonly List<string> _elements = new List<string>();
        private readonly List<int> _visibleAfter = new List<int>();
        private int _next;
        private float _wait;

        public bool IsTyping { get; private set; }

        public void TypeText(string text)
        {
            label.text = text;
            label.maxVisibleCharacters = 0;
            _elements.Clear();
            _visibleAfter.Clear();
            // Text elements are grapheme clusters; TextMeshPro counts code points (UTF-32).
            int visible = 0;
            TextElementEnumerator it = StringInfo.GetTextElementEnumerator(text);
            while (it.MoveNext())
            {
                string element = it.GetTextElement();
                for (int i = 0; i < element.Length; i++)
                {
                    if (!char.IsLowSurrogate(element[i])) visible++;
                }
                _elements.Add(element);
                _visibleAfter.Add(visible);
            }
            speaker.ResetSpeaker();
            _next = 0;
            _wait = 0f;
            IsTyping = true;
        }

        /// <summary>Shows the whole text at once and stops the voice.</summary>
        public void Skip()
        {
            if (!IsTyping) return;
            speaker.Stop();
            Finish();
        }

        private void Update()
        {
            if (!IsTyping) return;
            _wait -= Time.deltaTime;
            while (_wait <= 0f && _next < _elements.Count)
            {
                label.maxVisibleCharacters = _visibleAfter[_next];
                _wait += speaker.SpeakCharacter(_elements[_next]);
                _next++;
            }
            if (_next >= _elements.Count && _wait <= 0f) Finish();
        }

        private void Finish()
        {
            IsTyping = false;
            label.maxVisibleCharacters = int.MaxValue;
            onFinished.Invoke();
        }
    }
}
