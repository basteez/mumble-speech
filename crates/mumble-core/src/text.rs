//! Grapheme classification (R1.4, R1.5).
//!
//! Diacritics are folded through generated tables equivalent to "NFD, remove marks,
//! lowercase" (specs/design.md §4.1, LD11).

use crate::fold_tables::{FOLD, IGNORABLE};

/// Category of a grapheme. Letters carry their index, `a` = 0 … `z` = 25.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
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

/// Folds one character to `a–z` (0–25) or `0–9` (26–35) if it is one, accents and case aside (R1.4).
fn fold(c: char) -> Option<u8> {
    match c {
        'a'..='z' => Some(c as u8 - b'a'),
        'A'..='Z' => Some(c as u8 - b'A'),
        '0'..='9' => Some(26 + c as u8 - b'0'),
        _ if c.is_ascii() => None,
        _ => {
            let key = (c as u32) << 6;
            let i = FOLD.partition_point(|&entry| entry < key);
            FOLD.get(i).filter(|&&entry| entry >> 6 == c as u32).map(|&entry| (entry & 0x3f) as u8)
        }
    }
}

/// Combining marks and other characters that vanish when folding.
fn is_ignorable(c: char) -> bool {
    let c = c as u32;
    let i = IGNORABLE.partition_point(|&(_, end)| end < c);
    IGNORABLE.get(i).is_some_and(|&(start, _)| start <= c)
}

/// The letter or digit a grapheme stands for: exactly one non-ignorable character that folds.
fn base(grapheme: &str) -> Option<u8> {
    let mut found = None;
    for c in grapheme.chars().filter(|c| !is_ignorable(*c)) {
        if found.is_some() {
            return None;
        }
        found = Some(fold(c)?);
    }
    found
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
    match base(grapheme) {
        Some(n @ 0..=25) => TokenKind::Letter(n),
        Some(_) => TokenKind::Digit,
        None => TokenKind::Other,
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

    /// R1.4 as originally specified: NFD, marks removed, lowercased; then a–z / 0–9 / other.
    fn reference(grapheme: &str) -> Option<u8> {
        use alloc::string::String;
        use unicode_normalization::char::is_combining_mark;
        use unicode_normalization::UnicodeNormalization;
        let folded: String =
            grapheme.nfd().filter(|c| !is_combining_mark(*c)).flat_map(char::to_lowercase).collect();
        let mut chars = folded.chars();
        match (chars.next(), chars.next()) {
            (Some(c @ 'a'..='z'), None) => Some(c as u8 - b'a'),
            (Some(c @ '0'..='9'), None) => Some(26 + c as u8 - b'0'),
            _ => None,
        }
    }

    #[test]
    fn folding_tables_match_the_reference_for_every_scalar_value() {
        let mut buf = [0u8; 4];
        for c in (0..=0x10ffffu32).filter_map(char::from_u32) {
            let s = c.encode_utf8(&mut buf);
            assert_eq!(base(s), reference(s), "U+{:04X}", c as u32);
        }
    }

    #[test]
    fn folding_tables_match_the_reference_for_letters_with_marks() {
        let marks = ['\u{0300}', '\u{0301}', '\u{0308}', '\u{0323}', '\u{0344}', '\u{20DD}', '\u{FE0F}'];
        let bases = ['a', 'E', 'é', 'İ', 'ß', 'ж', '1', '\u{0301}', 'ǅ'];
        for b in bases {
            for m1 in marks {
                for m2 in marks {
                    let s: alloc::string::String = [b, m1, m2].iter().collect();
                    assert_eq!(base(&s), reference(&s), "{s:?}");
                    let pair: alloc::string::String = [b, b].iter().collect();
                    assert_eq!(base(&pair), reference(&pair), "{pair:?}");
                }
            }
        }
    }

    #[test]
    fn folds_accents_and_case() {
        for (input, expected) in [("è", 4), ("É", 4), ("ñ", 13), ("ü", 20), ("Å", 0), ("ç", 2), ("e\u{0301}", 4)] {
            assert_eq!(base(input), Some(expected), "{input:?}");
        }
        assert_eq!(base("ß"), None);
        assert_eq!(base("ж"), None);
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
