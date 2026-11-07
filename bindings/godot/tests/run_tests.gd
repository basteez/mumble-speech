# Headless tests of the Godot binding (specs/design.md §9.3, L4.6, L5.2). The checks are in
# suite.gd, shared with the web runner (web/runner.gd, §9.3.1, LD32).
# Run: godot --headless --path bindings/godot -s res://tests/run_tests.gd
extends SceneTree

const Suite = preload("res://tests/suite.gd")


func _initialize() -> void:
	_run.call_deferred()


func _run() -> void:
	print("Godot ", Engine.get_version_info().string, ", mix rate ", AudioServer.get_mix_rate())
	var vectors := ProjectSettings.globalize_path("res://").path_join("../../conformance/vectors.json")
	var suite := Suite.new(root, vectors)
	var failures: int = await suite.run()
	# The AudioServer releases finished playbacks on a later mix cycle; quitting right away
	# would report them as leaked.
	for i in 30:
		await process_frame
	print("checks: %d, failures: %d" % [suite.checks, failures])
	if failures == 0:
		print("all Godot binding tests passed")
	quit(1 if failures > 0 else 0)
