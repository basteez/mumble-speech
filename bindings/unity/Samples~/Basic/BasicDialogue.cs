using MumbleSpeech;
using UnityEngine;

/// <summary>
/// Minimal sample (L4.9): add it to a GameObject with a MumbleSpeaker (and its AudioSource),
/// press Play. Each line is said with a different style and shown as it is spoken (OnGUI,
/// so it needs no UI package).
/// </summary>
[RequireComponent(typeof(MumbleSpeaker))]
public sealed class BasicDialogue : MonoBehaviour
{
    private static readonly (MumbleStyle Style, string Text)[] Lines =
    {
        (MumbleStyle.Alphabet, "Hi there! Welcome to the village."),
        (MumbleStyle.Grunt, "Guh-huh! Did you bring the honey?"),
        (MumbleStyle.Beep, "* You feel like you're going to have a good time."),
    };

    private MumbleSpeaker _speaker;
    private int _line;
    private int _visible;

    private void Start()
    {
        _speaker = GetComponent<MumbleSpeaker>();
        _speaker.onCharacter.AddListener(index => _visible = index + 1);
        _speaker.onFinished.AddListener(() => Invoke(nameof(NextLine), 1f));
        SayLine();
    }

    private void NextLine()
    {
        _line = (_line + 1) % Lines.Length;
        SayLine();
    }

    private void SayLine()
    {
        var voice = ScriptableObject.CreateInstance<MumbleVoice>();
        voice.style = Lines[_line].Style;
        voice.pitch = 2f;
        voice.variation = 0.2f;
        voice.seed = _line;
        _speaker.voice = voice;
        _visible = 0;
        _speaker.Say(Lines[_line].Text);
    }

    private void OnGUI()
    {
        string text = Lines[_line].Text;
        string shown = _speaker != null && _speaker.IsSpeaking ? text.Substring(0, Mathf.Min(_visible, text.Length)) : text;
        GUI.Label(new Rect(40, 40, 800, 80), shown, new GUIStyle(GUI.skin.label) { fontSize = 28, wordWrap = true });
    }
}
