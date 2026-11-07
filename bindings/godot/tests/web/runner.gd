# The test runner of the web export (specs/design.md §9.3.1, L4.15, L4.16, L5.2, LD31, LD32).
# Runs the shared suite (tests/suite.gd) and the web-only checks, prints every failure and a last
# line `MUMBLE_WEB_TESTS PASS <n>` or `MUMBLE_WEB_TESTS FAIL <n>`, and sets
# `window.mumbleWebTests = { done, failures, checks, vectors, threads, log }` for scripts/godot-web/run-tests.mjs.
# `threads` says which engine ran (specs/design.md §9.3.2, LD39): true, false, or null when the engine reports neither tag.
# The vectors are copied to res://tests/web/vectors.json before the export (scripts/godot-web/export.sh).
extends Node

const Suite = preload("res://tests/suite.gd")
const VECTORS := "res://tests/web/vectors.json"
const LINE := "Hé 👋!"
# Bounds of L4.16, in seconds, each plus one frame.
const SPOKEN_LATE := 0.1
# Stream mode on the web (L4.16, decided 2026-11-07): the audio clock advances in large mix chunks
# behind a large output latency, so character_spoken gets the bound of finished.
const SPOKEN_LATE_STREAM := 0.5
const FINISHED_LATE := 0.25
const FINISHED_LATE_STREAM := 0.5

var suite: Suite
var failures := 0
var checks := 0
var lines := PackedStringArray()
# The longest frame while a line is measured: "one frame" in the bounds (CI renders in software).
var max_delta := 0.0
var measuring := false


func _ready() -> void:
	_run()


func _process(delta: float) -> void:
	if measuring:
		max_delta = maxf(max_delta, delta)


func log_line(message: String) -> void:
	lines.append(message)
	print(message)


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures += 1
		lines.append("FAIL: " + message)
		printerr("FAIL: ", message)


# Godot's web export adds the feature tag `threads` or `nothreads` from Thread Support. Returns true, false,
# or null when the engine reports neither (the browser runner then relies on the request log, LD39).
func threads_report():
	if OS.has_feature("threads"):
		return true
	if OS.has_feature("nothreads"):
		return false
	return null


func _run() -> void:
	log_line("MUMBLE_WEB_TESTS start: Godot %s, web feature %s, threads %s" % [Engine.get_version_info().string, OS.has_feature("web"), threads_report()])
	suite = Suite.new(self, VECTORS)
	await suite.run()
	failures += suite.failures
	checks += suite.checks
	log_line("MUMBLE_WEB_TESTS vectors %d" % suite.vectors_checked)
	if OS.has_feature("web"):
		await run_web_checks()
	else:
		log_line("not a web export: the web-only checks are skipped")
	# The AudioServer releases finished playbacks on a later mix cycle.
	for i in 30:
		await get_tree().process_frame
	finish()


func finish() -> void:
	var verdict := "MUMBLE_WEB_TESTS %s %d threads=%s" % ["PASS" if failures == 0 else "FAIL", checks, threads_report()]
	log_line(verdict)
	if OS.has_feature("web"):
		var result = JavaScriptBridge.create_object("Object")
		result.done = true
		result.failures = failures
		result.checks = checks
		result.vectors = suite.vectors_checked
		result.threads = threads_report()
		result.log = "\n".join(lines)
		JavaScriptBridge.get_interface("window").mumbleWebTests = result


# True when no page script says otherwise: run-tests.mjs defines window.mumbleAudioRunning to report
# whether an AudioContext is running; in a hand run (GW3) the user has clicked, so it is.
func audio_running() -> bool:
	return bool(JavaScriptBridge.eval("typeof window.mumbleAudioRunning === 'function' ? window.mumbleAudioRunning() : true", true))


func run_web_checks() -> void:
	var speaker := MumbleSpeaker.new()
	speaker.voice = MumbleVoice.new()
	add_child(speaker)

	# Sample mode is what the export plays in by default (LD30); without it the timing checks below
	# would test the wrong path.
	check(int(ProjectSettings.get_setting_with_override("audio/general/default_playback_type")) == 1,
		"audio/general/default_playback_type is Sample (1) in the web export")
	await measure_line(speaker, LINE, FINISHED_LATE, SPOKEN_LATE, "say (Sample mode)", true)
	var player := speaker.get_child(0) as AudioStreamPlayer
	check(player != null and player.playback_type == AudioServer.PLAYBACK_TYPE_DEFAULT,
		"the speaker's internal player keeps the default playback type")

	await check_restart(speaker)
	await check_stop(speaker)
	await check_typewriter()

	# Stream mode, with the audio clock: only meaningful while the AudioContext runs.
	if player != null:
		if audio_running():
			player.playback_type = AudioServer.PLAYBACK_TYPE_STREAM
			await measure_line(speaker, LINE, FINISHED_LATE_STREAM, SPOKEN_LATE_STREAM, "say (Stream mode)", false)
			player.playback_type = AudioServer.PLAYBACK_TYPE_DEFAULT
		else:
			log_line("the AudioContext is not running: the Stream mode check is skipped")
	speaker.queue_free()


# Says `text` and checks L4.16: character_spoken once per event, in order, no earlier than the event's
# start and at most `spoken_late` plus one frame after it; finished once, after the last
# character_spoken, at most `finished_late` plus one frame after the duration. Times are from the call.
func measure_line(speaker: MumbleSpeaker, text: String, finished_late: float, spoken_late: float, label: String, sample_mode: bool) -> void:
	var render: Dictionary = Mumble.render(text, speaker.voice, 48000)
	var spoken := []
	var finished := []
	var on_spoken := func(index: int): spoken.append([index, Time.get_ticks_usec()])
	var on_finished := func(): finished.append(Time.get_ticks_usec())
	speaker.character_spoken.connect(on_spoken)
	speaker.finished.connect(on_finished)
	max_delta = 0.0
	measuring = true
	var t0 := Time.get_ticks_usec()
	speaker.say(text)
	if sample_mode:
		var internal := speaker.get_child(0) as AudioStreamPlayer
		if internal != null and AudioServer.has_method("is_stream_registered_as_sample"):
			check(AudioServer.is_stream_registered_as_sample(internal.stream),
				"%s: the line's stream is registered with the browser as a sample" % label)
	var timeout_ms := int((render.duration + finished_late + 3.0) * 1000.0)
	var done: bool = await suite.wait_until(func(): return finished.size() > 0, timeout_ms)
	# A second `finished` would come within a few frames.
	await get_tree().create_timer(0.3).timeout
	measuring = false
	speaker.character_spoken.disconnect(on_spoken)
	speaker.finished.disconnect(on_finished)

	var frame := max_delta
	check(done, "%s: finished is emitted" % label)
	check(finished.size() == 1, "%s: finished is emitted exactly once, got %d" % [label, finished.size()])
	var want := []
	for event in render.events:
		want.append(event.char_index)
	var got := []
	for entry in spoken:
		got.append(entry[0])
	check(got == want, "%s: character_spoken indices %s, expected %s" % [label, got, want])
	var worst_spoken := 0.0
	for k in mini(spoken.size(), render.events.size()):
		var at := float(spoken[k][1] - t0) / 1000000.0
		var start: float = render.events[k].start
		worst_spoken = maxf(worst_spoken, at - start)
		check(at >= start, "%s: character %d spoken at %.3f s, before its start %.3f s" % [label, k, at, start])
		check(at <= start + spoken_late + frame,
			"%s: character %d spoken at %.3f s, later than start %.3f s + %.0f ms + one frame (%.0f ms)" % [label, k, at, start, spoken_late * 1000.0, frame * 1000.0])
	var late := -1.0
	if finished.size() > 0:
		var end := float(finished[0] - t0) / 1000000.0
		late = end - float(render.duration)
		check(spoken.is_empty() or finished[0] >= spoken[spoken.size() - 1][1], "%s: finished after the last character_spoken" % label)
		check(end <= render.duration + finished_late + frame,
			"%s: finished at %.3f s, later than duration %.3f s + %.0f ms + one frame (%.0f ms)" % [label, end, render.duration, finished_late * 1000.0, frame * 1000.0])
		if sample_mode:
			check(end >= render.duration, "%s: finished at %.3f s, before the duration %.3f s" % [label, end, render.duration])
	log_line("MUMBLE_WEB_TIMING %s: characters %d, latest character %.0f ms after its start, finished %.0f ms after the duration, longest frame %.0f ms"
		% [label, spoken.size(), worst_spoken * 1000.0, late * 1000.0, frame * 1000.0])


# A second `say` while a line runs restarts the clock: the first line's remaining events are not emitted.
func check_restart(speaker: MumbleSpeaker) -> void:
	var first := "Hello there, friend. Hello there, friend."
	var second := "Yo!"
	var render: Dictionary = Mumble.render(second, speaker.voice, 48000)
	var want := []
	for event in render.events:
		want.append(event.char_index)
	var spoken := []
	var finished := []
	var on_spoken := func(index: int): spoken.append(index)
	var on_finished := func(): finished.append(true)
	speaker.character_spoken.connect(on_spoken)
	speaker.finished.connect(on_finished)
	speaker.say(first)
	await get_tree().create_timer(0.15).timeout
	spoken.clear()
	speaker.say(second)
	var done: bool = await suite.wait_until(func(): return finished.size() > 0, int((render.duration + 3.0) * 1000.0))
	await get_tree().create_timer(0.3).timeout
	speaker.character_spoken.disconnect(on_spoken)
	speaker.finished.disconnect(on_finished)
	check(done, "restart: the second line finishes")
	check(finished.size() == 1, "restart: finished is emitted once, for the second line only, got %d" % finished.size())
	check(spoken == want, "restart: only the second line's characters are spoken, got %s, expected %s" % [spoken, want])


# stop() during a line: no further signal.
func check_stop(speaker: MumbleSpeaker) -> void:
	var signals_after_stop := []
	var on_spoken := func(index: int): signals_after_stop.append(index)
	var on_finished := func(): signals_after_stop.append("finished")
	speaker.say("Hello there, friend. Hello there, friend.")
	await get_tree().create_timer(0.15).timeout
	speaker.stop()
	speaker.character_spoken.connect(on_spoken)
	speaker.finished.connect(on_finished)
	await get_tree().create_timer(0.6).timeout
	speaker.character_spoken.disconnect(on_spoken)
	speaker.finished.disconnect(on_finished)
	check(not speaker.is_speaking(), "stop: not speaking after stop()")
	check(signals_after_stop.is_empty(), "stop: no signal after stop(), got %s" % [signals_after_stop])


# A long typed line in Sample mode finishes and reveals every grapheme in order (L4.16).
func check_typewriter() -> void:
	var label := Label.new()
	var speaker := MumbleSpeaker.new()
	var typewriter := MumbleTypewriter.new()
	for node in [label, speaker, typewriter]:
		add_child(node)
	typewriter.label = label.get_path()
	typewriter.speaker = speaker.get_path()
	var voice := MumbleVoice.new()
	voice.speed = 30.0
	speaker.voice = voice
	var text := ""
	for i in 7:
		text += "The quick brown fox jumps over the lazy dog. "
	var state := {"finished": 0, "visible": []}
	typewriter.finished.connect(func(): state.finished += 1)
	typewriter.type_text(text)
	var done: bool = await suite.wait_until(func():
		state.visible.append(label.visible_characters)
		return state.finished > 0, 30000)
	await get_tree().create_timer(0.3).timeout
	check(done, "typewriter: a %d-character line finishes in Sample mode" % text.length())
	check(state.finished == 1, "typewriter: finished is emitted once, got %d" % state.finished)
	check(label.visible_characters == -1, "typewriter: everything is visible at the end")
	var shown: Array = state.visible.filter(func(n): return n >= 0)
	var monotonic := true
	for i in range(1, shown.size()):
		monotonic = monotonic and shown[i] >= shown[i - 1]
	check(monotonic, "typewriter: reveals monotonically")
	check(shown.has(text.length()), "typewriter: reaches the last character (%d code points)" % text.length())
	for node in [label, speaker, typewriter]:
		node.queue_free()
