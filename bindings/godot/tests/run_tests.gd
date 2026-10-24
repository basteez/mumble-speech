# Headless tests of the Godot binding (specs/design.md §9.3, L4.6, L5.2).
# Run: godot --headless --path bindings/godot -s res://tests/run_tests.gd
extends SceneTree

const STYLES := {"beep": 0, "grunt": 1, "alphabet": 2}
# 0xcbf29ce484222325 as a signed 64-bit GDScript int.
const FNV_OFFSET := -3750763034362895579
const FNV_PRIME := 1099511628211

var failures := 0


func check(condition: bool, message: String) -> void:
	if not condition:
		failures += 1
		printerr("FAIL: ", message)


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	print("Godot ", Engine.get_version_info().string)
	test_voice_defaults()
	test_vectors()
	await test_typewriter()
	await test_say()
	# The AudioServer releases finished playbacks on a later mix cycle; quitting right away
	# would report them as leaked.
	for i in 30:
		await process_frame
	if failures == 0:
		print("all Godot binding tests passed")
	quit(1 if failures > 0 else 0)


# 64-bit FNV-1a over the little-endian bytes of the samples (LD7). GDScript ints wrap.
# Godot's string-to-float parsing (and so JSON) is not correctly rounded: it can be one ulp
# off. Times in the vectors are compared with this tolerance; the samples are exact (hash).
func same_time(a: float, b: float) -> bool:
	return absf(a - b) <= 1e-12


func pcm_hash(samples: PackedFloat32Array) -> String:
	var h := FNV_OFFSET
	for b in samples.to_byte_array():
		h = (h ^ b) * FNV_PRIME
	return "0x%08x%08x" % [(h >> 32) & 0xffffffff, h & 0xffffffff]


func test_voice_defaults() -> void:
	var v := MumbleVoice.new()
	check(v.style == MumbleVoice.BEEP and v.pitch == 0.0 and v.speed == 15.0 and v.variation == 0.0 and v.seed == 0,
		"MumbleVoice defaults")


func test_vectors() -> void:
	var path := ProjectSettings.globalize_path("res://").path_join("../../conformance/vectors.json")
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	check(data != null, "vectors.json readable at " + path)
	if data == null:
		return
	var started := Time.get_ticks_msec()
	for v in data.vectors:
		var voice := MumbleVoice.new()
		voice.style = STYLES[v.voice.style]
		voice.pitch = v.voice.pitch
		voice.speed = v.voice.speed
		voice.variation = v.voice.variation
		voice.seed = int(v.voice.seed)
		var r: Dictionary = Mumble.render(v.text, voice, int(v.sampleRate))
		if v.expected.has("error"):
			check(r.get("error") == v.expected.error, "%s: expected error %s, got %s" % [v.id, v.expected.error, r])
			continue
		var samples: PackedFloat32Array = r.samples
		check(samples.size() == int(v.expected.sampleCount), "%s: sample count %d" % [v.id, samples.size()])
		check(pcm_hash(samples) == v.expected.pcmHash, "%s: PCM hash %s" % [v.id, pcm_hash(samples)])
		check(same_time(r.duration, v.expected.duration), "%s: duration" % v.id)
		var events: Array = r.events
		check(events.size() == v.expected.events.size(), "%s: event count" % v.id)
		var utf8: PackedByteArray = v.text.to_utf8_buffer()
		for i in min(events.size(), v.expected.events.size()):
			var got: Dictionary = events[i]
			var want: Dictionary = v.expected.events[i]
			# Code point index in the Godot String, derived independently from the UTF-8 offset.
			var char_index := utf8.slice(0, int(want.utf8[0])).get_string_from_utf8().length()
			check(got.char_index == char_index, "%s[%d]: char_index %d, expected %d" % [v.id, i, got.char_index, char_index])
			check(same_time(got.start, want.start) and same_time(got.duration, want.duration),
				"%s[%d]: timing %s/%s vs %s/%s" % [v.id, i, got.start, got.duration, want.start, want.duration])
			check("#" + got.color.to_html(false) == want.rgb, "%s[%d]: color %s" % [v.id, i, got.color.to_html(false)])
			check(got.size == want.size, "%s[%d]: size" % [v.id, i])
	print("vectors: %d checked in %d ms" % [data.vectors.size(), Time.get_ticks_msec() - started])


func wait_until(done: Callable, timeout_ms: int) -> bool:
	var deadline := Time.get_ticks_msec() + timeout_ms
	while not done.call() and Time.get_ticks_msec() < deadline:
		await process_frame
	return done.call()


func test_typewriter() -> void:
	var label := Label.new()
	var speaker := MumbleSpeaker.new()
	var typewriter := MumbleTypewriter.new()
	for node in [label, speaker, typewriter]:
		root.add_child(node)
	typewriter.label = label.get_path()
	typewriter.speaker = speaker.get_path()
	var voice := MumbleVoice.new()
	voice.style = MumbleVoice.ALPHABET
	voice.speed = 30.0
	speaker.voice = voice

	var state := {"finished": false, "visible": []}
	typewriter.finished.connect(func(): state.finished = true)
	var text := "Hi, 👋 è!"
	typewriter.type_text(text)
	check(label.text == text and label.visible_characters == 0, "typewriter sets the text, nothing visible yet")
	var ok := await wait_until(func():
		state.visible.append(label.visible_characters)
		return state.finished, 5000)
	check(ok, "typewriter emits finished")
	check(label.visible_characters == -1, "typewriter shows everything at the end")
	var shown: Array = state.visible.filter(func(n): return n >= 0)
	check(shown.size() > 1, "typewriter recorded progress")
	for i in range(1, shown.size()):
		check(shown[i] >= shown[i - 1], "typewriter reveals monotonically")
	check(shown.has(text.length()), "typewriter reaches the last character (%d code points)" % text.length())

	typewriter.type_text("A long line that will be skipped.")
	typewriter.skip()
	check(not typewriter.is_typing() and label.visible_characters == -1, "skip shows everything")
	for node in [label, speaker, typewriter]:
		node.queue_free()
	await process_frame


func test_say() -> void:
	var speaker := MumbleSpeaker.new()
	root.add_child(speaker)
	var state := {"finished": false, "spoken": []}
	speaker.finished.connect(func(): state.finished = true)
	speaker.character_spoken.connect(func(i): state.spoken.append(i))
	var stream := speaker.render_stream("Hello")
	check(stream != null and stream.get_length() > 0.0, "render_stream returns a stream")
	speaker.say("Hé 👋!")
	check(speaker.is_speaking(), "say starts speaking")
	var ok := await wait_until(func(): return state.finished, 5000)
	check(ok, "say emits finished (audio clock advanced)")
	check(state.spoken == [0, 1, 3], "character_spoken code point indices, got %s" % [state.spoken])
	speaker.queue_free()
