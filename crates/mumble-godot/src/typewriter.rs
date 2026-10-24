use crate::speaker::MumbleSpeaker;
use godot::classes::INode;
use godot::prelude::*;
use unicode_segmentation::UnicodeSegmentation;

/// Reveals a `Label` or `RichTextLabel` one character at a time, in sync with a `MumbleSpeaker`.
#[derive(GodotClass)]
#[class(base = Node)]
pub struct MumbleTypewriter {
    /// A `Label` or `RichTextLabel`.
    #[export]
    label: NodePath,
    #[export]
    speaker: NodePath,
    /// `(code points visible after it, grapheme)` for each grapheme of the line.
    graphemes: Vec<(i64, String)>,
    next: usize,
    wait: f64,
    typing: bool,
    base: Base<Node>,
}

#[godot_api]
impl INode for MumbleTypewriter {
    fn init(base: Base<Node>) -> Self {
        Self {
            label: NodePath::default(),
            speaker: NodePath::default(),
            graphemes: Vec::new(),
            next: 0,
            wait: 0.0,
            typing: false,
            base,
        }
    }

    fn process(&mut self, delta: f64) {
        if !self.typing {
            return;
        }
        self.wait -= delta;
        while self.wait <= 0.0 && self.next < self.graphemes.len() {
            let (visible, grapheme) = self.graphemes[self.next].clone();
            self.next += 1;
            self.set_visible(visible);
            if let Some(mut speaker) = self.speaker_node() {
                self.wait += speaker.bind_mut().speak_character(grapheme.as_str().into());
            }
        }
        if self.next >= self.graphemes.len() && self.wait <= 0.0 {
            self.finish();
        }
    }
}

#[godot_api]
impl MumbleTypewriter {
    /// Emitted when the whole line is visible.
    #[signal]
    pub fn finished();

    /// Sets the label's text and starts revealing it.
    #[func]
    pub fn type_text(&mut self, text: GString) {
        let text_string = text.to_string();
        let mut visible = 0;
        self.graphemes = text_string
            .graphemes(true)
            .map(|g| {
                visible += g.chars().count() as i64;
                (visible, g.to_string())
            })
            .collect();
        if let Some(mut label) = self.label_node() {
            label.set("text", &text.to_variant());
        }
        self.set_visible(0);
        if let Some(mut speaker) = self.speaker_node() {
            speaker.bind_mut().reset();
        }
        self.next = 0;
        self.wait = 0.0;
        self.typing = true;
    }

    /// Shows the whole line at once and stops the voice.
    #[func]
    pub fn skip(&mut self) {
        if !self.typing {
            return;
        }
        if let Some(mut speaker) = self.speaker_node() {
            speaker.bind_mut().stop();
        }
        self.finish();
    }

    #[func]
    pub fn is_typing(&self) -> bool {
        self.typing
    }
}

impl MumbleTypewriter {
    fn finish(&mut self) {
        self.typing = false;
        self.set_visible(-1);
        self.signals().finished().emit();
    }

    fn set_visible(&mut self, count: i64) {
        if let Some(mut label) = self.label_node() {
            label.set("visible_characters", &count.to_variant());
        }
    }

    fn label_node(&self) -> Option<Gd<Node>> {
        self.base().get_node_or_null(&self.label)
    }

    fn speaker_node(&self) -> Option<Gd<MumbleSpeaker>> {
        self.base().get_node_or_null(&self.speaker).and_then(|n| n.try_cast::<MumbleSpeaker>().ok())
    }
}
