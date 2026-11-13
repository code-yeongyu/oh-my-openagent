//! Where `ax.selectText`'s text sits inside an element's value. Accessibility text ranges count
//! UTF-16 code units, so every offset here is in UTF-16 units, never bytes or scalars (the old
//! tree's `text_range.rs`, itself from oh-my-pi, MIT).

/// A selection in UTF-16 code units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Utf16Range {
    pub start: usize,
    pub length: usize,
}

/// Why a text request names no one range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoRange {
    /// The text does not occur in the value.
    Absent,
    /// It occurs more than once, so the request names no single range.
    Ambiguous { occurrences: usize },
}

/// The one range of `value` that `text` names.
///
/// # Errors
/// [`NoRange`] when the text is absent or occurs more than once.
pub fn locate(value: &str, text: &str) -> Result<Utf16Range, NoRange> {
    let mut units = 0usize;
    let mut first: Option<usize> = None;
    let mut occurrences = 0usize;
    for (byte, character) in value.char_indices() {
        if !text.is_empty() && value[byte..].starts_with(text) {
            occurrences += 1;
            first.get_or_insert(units);
        }
        units = units.saturating_add(character.len_utf16());
    }
    match (occurrences, first) {
        (1, Some(start)) => Ok(Utf16Range { start, length: text.encode_utf16().count() }),
        (0, _) | (_, None) => Err(NoRange::Absent),
        (occurrences, _) => Err(NoRange::Ambiguous { occurrences }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_range_counts_utf16_units_not_bytes_or_scalars() {
        let value = "a\u{1F4CB}bc";
        assert_eq!(locate(value, "bc"), Ok(Utf16Range { start: 3, length: 2 }), "the emoji is two units");
        assert_eq!(locate(value, "a"), Ok(Utf16Range { start: 0, length: 1 }));
        assert_eq!(locate(value, "zz"), Err(NoRange::Absent));
        assert_eq!(locate("abab", "ab"), Err(NoRange::Ambiguous { occurrences: 2 }));
        assert_eq!(locate("abc", ""), Err(NoRange::Absent), "an empty text names no range");
    }
}
