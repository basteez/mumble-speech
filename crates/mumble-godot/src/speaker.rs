use crate::audio::{char_index, mix_rate, stream};
use crate::voice::{core_voice, error_name, MumbleVoice};
use godot::classes::{AudioServer, AudioStreamPlayer, AudioStreamWav, INode};
use godot::prelude::*;
use mumble_speech as core;

/// Speaks lines or single characters through an internal `AudioStreamPlayer`.
#[derive(GodotClass)]
#[class(base = Node)]
pub struct MumbleSpeaker {
    #[export]
    voice: Option<Gd<MumbleVoice>>,
    #[export]
    bus: StringName,
    #[export(range = (-80.0, 24.0, 0.1))]
    volume_db: f64,
    player: Option<Gd<AudioStreamPlayer>>,
    /// Typewriter state, created lazily and reset per line.
    typewriter: Option<core::Speaker>,
    /// `(start seconds, char index)` of the line being said.
    events: Vec<(f64, i64)>,
    next_event: usize,
    duration: f64,
    speaking: bool,
    base: Base<Node>,
}

#[godot_api]
impl INode for MumbleSpeaker {
    fn init(base: Base<Node>) -> Self {
        Self {
            voice: None,
            bus: "Master".into(),
            volume_db: 0.0,
            player: None,
            typewriter: None,
            events: Vec::new(),
            next_event: 0,
            duration: 0.0,
            speaking: false,
            base,
        }
    }

    /// Stops the voice when leaving the tree, so the AudioServer drops the playback right away.
    fn exit_tree(&mut self) {
        self.stop();
    }

    fn process(&mut self, _delta: f64) {
        if !self.speaking {
            return;
        }
        let position = self.position();
        while let Some(&(start, index)) = self.events.get(self.next_event) {
            if start > position {
                break;
            }
            self.next_event += 1;
            self.signals().character_spoken().emit(index);
        }
        if position >= self.duration {
            self.speaking = false;
            self.signals().finished().emit();
        }
    }
}

#[godot_api]
impl MumbleSpeaker {
    /// Emitted when the sound of the character at `char_index` is heard.
    #[signal]
    pub fn character_spoken(char_index: i64);

    /// Emitted when a line started with `say` has been heard to the end.
    #[signal]
    pub fn finished();

    /// Renders and plays a whole line.
    #[func]
    pub fn say(&mut self, text: GString) {
        let text = text.to_string();
        let sample_rate = mix_rate();
        let render = match core::render(&text, &core_voice(&self.voice), sample_rate) {
            Ok(r) => r,
            Err(e) => return godot_error!("MumbleSpeaker.say: {}", error_name(e)),
        };
        self.events = render.timeline.events.iter().map(|e| (e.start, char_index(&text, e.utf8_start))).collect();
        self.next_event = 0;
        self.duration = render.timeline.duration;
        self.play(stream(&render.samples, sample_rate));
        self.speaking = true;
    }

    /// Plays the sound of one character (typewriter mode) and returns the seconds to
    /// wait before the next one. Characters of a line must go through the same speaker
    /// in order; call `reset()` before a new line.
    #[func]
    pub fn speak_character(&mut self, text: GString) -> f64 {
        let sample_rate = mix_rate();
        if self.typewriter.is_none() {
            match core::Speaker::new(core_voice(&self.voice), sample_rate) {
                Ok(s) => self.typewriter = Some(s),
                Err(e) => {
                    godot_error!("MumbleSpeaker.speak_character: {}", error_name(e));
                    return 0.0;
                }
            }
        }
        let utterance = self.typewriter.as_mut().expect("created above").next(&text.to_string());
        if !utterance.samples.is_empty() {
            self.play(stream(&utterance.samples, sample_rate));
        }
        utterance.advance
    }

    /// Starts the next `speak_character` sequence from the voice's initial state.
    #[func]
    pub fn reset(&mut self) {
        self.typewriter = None;
    }

    #[func]
    pub fn stop(&mut self) {
        self.speaking = false;
        if let Some(player) = self.player.as_mut() {
            player.stop();
        }
    }

    #[func]
    pub fn is_speaking(&self) -> bool {
        self.speaking
    }

    /// The line as a 16-bit stream at the mix rate, to play or save yourself.
    #[func]
    pub fn render_stream(&self, text: GString) -> Option<Gd<AudioStreamWav>> {
        let sample_rate = mix_rate();
        match core::render(&text.to_string(), &core_voice(&self.voice), sample_rate) {
            Ok(r) => Some(stream(&r.samples, sample_rate)),
            Err(e) => {
                godot_error!("MumbleSpeaker.render_stream: {}", error_name(e));
                None
            }
        }
    }
}

impl MumbleSpeaker {
    fn play(&mut self, stream: Gd<AudioStreamWav>) {
        let bus = self.bus.clone();
        let volume = self.volume_db as f32;
        let mut player = match self.player.clone() {
            Some(p) => p,
            None => {
                let p = AudioStreamPlayer::new_alloc();
                self.base_mut().add_child(&p);
                self.player = Some(p.clone());
                p
            }
        };
        player.set_bus(&bus);
        player.set_volume_db(volume);
        player.set_stream(&stream);
        player.play();
    }

    /// Seconds of the current line heard so far (audio clock, latency-compensated).
    fn position(&self) -> f64 {
        let Some(player) = self.player.as_ref() else {
            return 0.0;
        };
        let server = AudioServer::singleton();
        player.get_playback_position() as f64 + server.get_time_since_last_mix() - server.get_output_latency()
    }
}
