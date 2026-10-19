//! Normalization and grapheme classification (R1.4, R1.5).

use alloc::string::String;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// Category of a grapheme. Letters carry their index, `a` = 0 … `z` = 25.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenKind {
    Letter(u8),
    Digit,
    Space,
    PauseShort,
    PauseLong,
    Other,
}

impl TokenKind {
    /// Letters, digits and other symbols make a sound; spaces and pauses do not.
    pub const fn is_audible(self) -> bool {
        matches!(self, TokenKind::Letter(_) | TokenKind::Digit | TokenKind::Other)
    }

    /// Slots taken by the grapheme (R3.6).
    pub(crate) const fn slots(self) -> u32 {
        match self {
            TokenKind::PauseShort => 2,
            TokenKind::PauseLong => 4,
            _ => 1,
        }
    }
}

/// Strips diacritics and lowercases: `è` → `e`, `Ñ` → `n` (R1.4).
pub fn normalize(grapheme: &str) -> String {
    grapheme.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect()
}

/// Classifies one grapheme into exactly one category (R1.5).
pub fn classify(grapheme: &str) -> TokenKind {
    if grapheme.contains('\n') || matches!(grapheme, "." | "!" | "?" | "…") {
        return TokenKind::PauseLong;
    }
    if matches!(grapheme, "," | ";" | ":") {
        return TokenKind::PauseShort;
    }
    if !grapheme.is_empty() && grapheme.chars().all(char::is_whitespace) {
        return TokenKind::Space;
    }
    let mut base = grapheme.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase);
    match (base.next(), base.next()) {
        (Some(c @ 'a'..='z'), None) => TokenKind::Letter(c as u8 - b'a'),
        (Some('0'..='9'), None) => TokenKind::Digit,
        _ => TokenKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;
    use unicode_segmentation::UnicodeSegmentation;

    fn kinds(text: &str) -> Vec<TokenKind> {
        text.graphemes(true).map(classify).collect()
    }

    #[test]
    fn normalize_strips_diacritics_and_lowercases() {
        for (input, expected) in [("è", "e"), ("É", "e"), ("ñ", "n"), ("ü", "u"), ("Å", "a"), ("ç", "c")] {
            assert_eq!(normalize(input), expected);
        }
        assert_eq!(normalize("ß"), "ß");
        assert_eq!(normalize("ж"), "ж");
    }

    #[test]
    fn classifies_every_category() {
        use TokenKind::*;
        assert_eq!(
            kinds("Ab 1,;:.!?…\n\t#"),
            [
                Letter(0),
                Letter(1),
                Space,
                Digit,
                PauseShort,
                PauseShort,
                PauseShort,
                PauseLong,
                PauseLong,
                PauseLong,
                PauseLong,
                PauseLong,
                Space,
                Other
            ]
        );
    }

    #[test]
    fn accented_letters_are_their_base_letter() {
        assert_eq!(classify("é"), TokenKind::Letter(4));
        assert_eq!(classify("Ñ"), TokenKind::Letter(13));
    }

    #[test]
    fn composed_emoji_is_one_other_token() {
        assert_eq!(kinds("a👨‍👩‍👧b"), [TokenKind::Letter(0), TokenKind::Other, TokenKind::Letter(1)]);
    }

    #[test]
    fn crlf_is_one_long_pause() {
        assert_eq!(kinds("a\r\nb"), [TokenKind::Letter(0), TokenKind::PauseLong, TokenKind::Letter(1)]);
    }

    #[test]
    fn only_letters_digits_and_other_are_audible() {
        let audible = |text: &str| kinds(text).iter().any(|k| k.is_audible());
        for text in ["", "   ", "...!?", "... !!!"] {
            assert!(!audible(text), "{text:?}");
        }
        for text in ["a", "1", "#", " 👋 "] {
            assert!(audible(text), "{text:?}");
        }
    }

    #[test]
    fn non_latin_letters_are_other() {
        assert_eq!(kinds("жλß"), [TokenKind::Other, TokenKind::Other, TokenKind::Other]);
    }
}
