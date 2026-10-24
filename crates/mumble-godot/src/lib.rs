//! Godot 4 binding of mumble-speech (specs/design.md §9.3, L4.6).

use godot::prelude::*;

mod audio;
mod mumble;
mod speaker;
mod typewriter;
mod voice;

struct MumbleSpeechExtension;

#[gdextension]
unsafe impl ExtensionLibrary for MumbleSpeechExtension {}
