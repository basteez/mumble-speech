# Minimal dialogue (L4.9): each line is revealed character by character in sync with the voice.
extends Control

const LINES := [
	["alphabet", "Hi there! Welcome to the village."],
	["grunt", "Guh-huh! Did you bring the honey?"],
	["beep", "* You feel like you're going to have a good time."],
]

var _line := 0

@onready var _speaker: MumbleSpeaker = $Speaker
@onready var _typewriter: MumbleTypewriter = $Typewriter


func _ready() -> void:
	_show_line()


func _unhandled_input(event: InputEvent) -> void:
	if not event.is_action_pressed("ui_accept"):
		return
	if _typewriter.is_typing():
		_typewriter.skip()
	else:
		_line = (_line + 1) % LINES.size()
		_show_line()


func _show_line() -> void:
	var voice := MumbleVoice.new()
	voice.style = {"beep": MumbleVoice.BEEP, "grunt": MumbleVoice.GRUNT, "alphabet": MumbleVoice.ALPHABET}[LINES[_line][0]]
	voice.pitch = 2.0
	voice.variation = 0.2
	voice.seed = _line
	_speaker.voice = voice
	_typewriter.type_text(LINES[_line][1])
