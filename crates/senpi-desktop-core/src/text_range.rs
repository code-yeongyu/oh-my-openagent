//! Locating text inside an element's value for AX text selection.
//!
//! Ported from oh-my-pi's `pi-natives/src/desktop/text_range.rs` (MIT).
//!
//! Accessibility text ranges count UTF-16 code units, so every offset here is
//! in UTF-16 units, never UTF-8 bytes or Unicode scalars.
use std::fmt::Write as _;

use crate::error::{CoreResult, DesktopError};

/// How many match offsets an ambiguity error lists.
const LISTED_MATCHES: usize = 8;

/// Which part of the matched text becomes the selection.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SelectPart {
    /// The matched text itself.
    #[default]
    Text,
    /// A zero-length caret before the match.
    Start,
    /// A zero-length caret after the match.
    End,
}

impl SelectPart {
    pub fn parse(value: Option<&str>) -> CoreResult<Self> {
        match value.unwrap_or("text") {
            "text" => Ok(Self::Text),
            "start" => Ok(Self::Start),
            "end" => Ok(Self::End),
            other => Err(DesktopError::ax_failed(format!(
                "select must be \"text\", \"start\" or \"end\", not {other:?}; nothing was selected"
            ))),
        }
    }
}

/// A request to select `text` where it follows `prefix` and precedes
/// `suffix`; empty context matches anywhere.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TextSelectRequest {
    pub text: String,
    pub prefix: String,
    pub suffix: String,
    pub part: SelectPart,
}

/// A selection in UTF-16 code units.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Utf16Range {
    pub start: usize,
    pub length: usize,
}

impl TextSelectRequest {
    /// The one range of `value` this request names. Refuses when the text does
    /// not occur, occurs only outside the given context, or occurs more than
    /// once in it.
    pub fn locate(&self, value: &str) -> CoreResult<Utf16Range> {
        let has_context = !self.prefix.is_empty() || !self.suffix.is_empty();
        if self.text.is_empty() && !has_context {
            return Err(DesktopError::ax_failed(
                "text is empty and no prefix or suffix says where to put the caret; nothing was \
                 selected",
            ));
        }
        let mut occurrences = 0usize;
        let mut matched = 0usize;
        let mut listed = [0usize; LISTED_MATCHES];
        let mut units = 0usize;
        let boundaries = value
            .char_indices()
            .map(|(byte, character)| (byte, character.len_utf16()))
            .chain(std::iter::once((value.len(), 0)));
        for (byte, width) in boundaries {
            let rest = &value[byte..];
            if rest.starts_with(&self.text) {
                occurrences += 1;
                if value[..byte].ends_with(&self.prefix)
                    && rest[self.text.len()..].starts_with(&self.suffix)
                {
                    if let Some(slot) = listed.get_mut(matched) {
                        *slot = units;
                    }
                    matched += 1;
                }
            }
            units += width;
        }
        let listed = &listed[..matched.min(LISTED_MATCHES)];
        match (matched, listed) {
            (1, [start]) => {
                let length = self.text.encode_utf16().count();
                Ok(match self.part {
                    SelectPart::Text => Utf16Range { start: *start, length },
                    SelectPart::Start => Utf16Range { start: *start, length: 0 },
                    SelectPart::End => Utf16Range { start: start + length, length: 0 },
                })
            },
            (0, _) if occurrences == 0 => Err(DesktopError::ax_failed(format!(
                "{:?} does not occur in the element's value ({units} UTF-16 units); nothing was \
                 selected",
                self.text
            ))),
            (0, _) if self.text.is_empty() => Err(DesktopError::ax_failed(format!(
                "no position in the element's value is {}; nothing was selected",
                self.context()
            ))),
            (0, _) => Err(DesktopError::ax_failed(format!(
                "{:?} occurs {occurrences} time(s) in the element's value, but none {}; nothing was \
                 selected",
                self.text,
                self.context()
            ))),
            _ => {
                let mut offsets = String::new();
                for (index, start) in listed.iter().enumerate() {
                    let _ = write!(offsets, "{}{start}", if index == 0 { "" } else { ", " });
                }
                if matched > LISTED_MATCHES {
                    offsets.push_str(", …");
                }
                let scope = if has_context {
                    format!(" {}", self.context())
                } else {
                    String::new()
                };
                Err(DesktopError::ax_failed(format!(
                    "{:?} occurs {matched} times{scope} (UTF-16 offsets {offsets}), so it is \
                     ambiguous; give a longer prefix or suffix to choose one; nothing was selected",
                    self.text,
                )))
            },
        }
    }

    fn context(&self) -> String {
        match (self.prefix.is_empty(), self.suffix.is_empty()) {
            (false, false) => {
                format!(
                    "after prefix {:?} and before suffix {:?}",
                    self.prefix, self.suffix
                )
            }
            (false, true) => format!("after prefix {:?}", self.prefix),
            (true, false) => format!("before suffix {:?}", self.suffix),
            (true, true) => String::new(),
        }
    }
}

/// The text of `value` in a UTF-16 range, or `None` when the range runs past
/// the end or splits a surrogate pair.
pub fn utf16_slice(value: &str, range: Utf16Range) -> Option<&str> {
    value.get(utf16_byte_range(value, range)?)
}

/// The UTF-8 byte range of a UTF-16 range in `value`, or `None` when the range
/// runs past the end or splits a surrogate pair. AX text ranges count UTF-16
/// units; every AX read and write converts through here.
pub fn utf16_byte_range(value: &str, range: Utf16Range) -> Option<std::ops::Range<usize>> {
    let start = utf16_byte_offset(value, range.start)?;
    let end = utf16_byte_offset(value, range.start.checked_add(range.length)?)?;
    Some(start..end)
}

fn utf16_byte_offset(value: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, character) in value.char_indices() {
        if units == offset {
            return Some(byte);
        }
        if units > offset {
            return None;
        }
        units += character.len_utf16();
    }
    (units == offset).then_some(value.len())
}

/// `value` with the UTF-16 `range` replaced by `replacement`; fails when the
/// range runs past the end or splits a surrogate pair.
pub fn replace_utf16_selection(
    value: &str,
    range: Utf16Range,
    replacement: &str,
) -> CoreResult<String> {
    let bytes = utf16_byte_range(value, range).ok_or_else(|| {
        DesktopError::ax_failed(format!(
            "selection {}+{} is outside the element's value or splits a character; nothing was \
             replaced",
            range.start, range.length
        ))
    })?;
    let mut out = String::with_capacity(value.len() - bytes.len() + replacement.len());
    out.push_str(&value[..bytes.start]);
    out.push_str(replacement);
    out.push_str(&value[bytes.end..]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{replace_utf16_selection, utf16_slice, SelectPart, TextSelectRequest, Utf16Range};

    fn request(text: &str, prefix: &str, suffix: &str, part: SelectPart) -> TextSelectRequest {
        TextSelectRequest {
            text: text.to_owned(),
            prefix: prefix.to_owned(),
            suffix: suffix.to_owned(),
            part,
        }
    }

    fn range(start: usize, length: usize) -> Utf16Range {
        Utf16Range { start, length }
    }

    #[test]
    fn unique_text_selects_its_utf16_range() {
        let value = "Hello, world";
        assert_eq!(
            request("world", "", "", SelectPart::Text)
                .locate(value)
                .unwrap(),
            range(7, 5)
        );
        assert_eq!(
            request("world", "", "", SelectPart::Start)
                .locate(value)
                .unwrap(),
            range(7, 0)
        );
        assert_eq!(
            request("world", "", "", SelectPart::End)
                .locate(value)
                .unwrap(),
            range(12, 0)
        );
    }

    #[test]
    fn offsets_count_utf16_units_past_emoji_and_accents() {
        // 😀 is two UTF-16 units and four UTF-8 bytes; é is one unit and two
        // bytes.
        let value = "😀 café 😀 tea";
        let found = request("tea", "", "", SelectPart::Text)
            .locate(value)
            .unwrap();
        assert_eq!(found, range(11, 3));
        assert_eq!(utf16_slice(value, found), Some("tea"));
        let emoji = request("😀", "café ", "", SelectPart::Text)
            .locate(value)
            .unwrap();
        assert_eq!(emoji, range(8, 2));
        assert_eq!(utf16_slice(value, emoji), Some("😀"));
    }

    #[test]
    fn repeated_text_without_context_is_refused_with_its_offsets() {
        let error = request("cat", "", "", SelectPart::Text)
            .locate("cat and cat")
            .unwrap_err();
        assert!(error.message.contains("occurs 2 times"), "{error}");
        assert!(error.message.contains("offsets 0, 8"), "{error}");
        assert!(error.message.contains("ambiguous"), "{error}");
    }

    #[test]
    fn prefix_or_suffix_picks_one_occurrence() {
        let value = "red cat, blue cat, red dog";
        assert_eq!(
            request("cat", "blue ", "", SelectPart::Text)
                .locate(value)
                .unwrap(),
            range(14, 3)
        );
        assert_eq!(
            request("red", "", " dog", SelectPart::Text)
                .locate(value)
                .unwrap(),
            range(19, 3)
        );
        assert_eq!(
            request("cat", "red ", ",", SelectPart::End)
                .locate(value)
                .unwrap(),
            range(7, 0)
        );
    }

    #[test]
    fn context_that_still_matches_twice_stays_ambiguous() {
        let error = request("cat", "red ", "", SelectPart::Text)
            .locate("red cat, red cat")
            .unwrap_err();
        assert!(
            error
                .message
                .contains("occurs 2 times after prefix \"red \""),
            "{error}"
        );
    }

    #[test]
    fn missing_text_and_unmatched_context_are_told_apart() {
        let missing = request("dog", "", "", SelectPart::Text)
            .locate("cat")
            .unwrap_err();
        assert!(missing.message.contains("does not occur"), "{missing}");
        let unmatched = request("cat", "blue ", "", SelectPart::Text)
            .locate("red cat")
            .unwrap_err();
        assert!(
            unmatched.message.contains("occurs 1 time(s)"),
            "{unmatched}"
        );
        assert!(
            unmatched.message.contains("none after prefix \"blue \""),
            "{unmatched}"
        );
    }

    #[test]
    fn many_matches_list_the_first_offsets_and_count_them_all() {
        let error = request("x", "", "", SelectPart::Text)
            .locate("xxxxxxxxxxxx")
            .unwrap_err();
        assert!(error.message.contains("occurs 12 times"), "{error}");
        assert!(
            error.message.contains("offsets 0, 1, 2, 3, 4, 5, 6, 7, …)"),
            "{error}"
        );
    }

    #[test]
    fn overlapping_occurrences_all_count() {
        let error = request("aa", "", "", SelectPart::Text)
            .locate("aaa")
            .unwrap_err();
        assert!(error.message.contains("offsets 0, 1"), "{error}");
    }

    #[test]
    fn empty_text_places_a_caret_by_context_alone() {
        let value = "first line\nsecond line";
        assert_eq!(
            request("", "line\n", "", SelectPart::Text)
                .locate(value)
                .unwrap(),
            range(11, 0)
        );
        let unplaced = request("", "", "", SelectPart::Text)
            .locate("")
            .unwrap_err();
        assert!(unplaced.message.contains("text is empty"), "{unplaced}");
        let unmatched = request("", "third ", "", SelectPart::Text)
            .locate(value)
            .unwrap_err();
        assert!(
            unmatched
                .message
                .contains("no position in the element's value is after prefix \"third \""),
            "{unmatched}"
        );
    }

    #[test]
    fn unknown_select_part_is_refused() {
        assert_eq!(SelectPart::parse(None).unwrap(), SelectPart::Text);
        assert_eq!(SelectPart::parse(Some("end")).unwrap(), SelectPart::End);
        assert!(SelectPart::parse(Some("caret")).is_err());
    }

    #[test]
    fn slices_refuse_ranges_past_the_end_or_inside_a_surrogate_pair() {
        assert_eq!(utf16_slice("a😀b", range(1, 2)), Some("😀"));
        assert_eq!(utf16_slice("a😀b", range(4, 0)), Some(""));
        assert_eq!(utf16_slice("a😀b", range(2, 1)), None);
        assert_eq!(utf16_slice("a😀b", range(3, 5)), None);
    }
    #[test]
    fn replacing_a_selection_works_in_utf16_units() {
        let value = "a😀b";
        assert_eq!(
            replace_utf16_selection(value, range(1, 2), "x").unwrap(),
            "axb"
        );
        assert_eq!(
            replace_utf16_selection(value, range(4, 0), "!").unwrap(),
            "a😀b!"
        );
        assert!(replace_utf16_selection(value, range(2, 1), "x").is_err());
        assert!(replace_utf16_selection(value, range(3, 5), "x").is_err());
    }
}
