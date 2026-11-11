//! The redaction table as it applies to the audit, the trace and the pre-input marker.

use super::chain::sha256_16;
use super::line::TextRecord;

/// Over this many characters a string is truncated with a marker.
pub const MAX_CHARS: usize = 256;

/// Text as `{length, sha256_16}`, or `{length}` only under the secure predicate.
#[must_use]
pub fn text(value: &str, secure: bool) -> TextRecord {
    TextRecord {
        length: value.chars().count(),
        sha256_16: (!secure).then(|| sha256_16(value.as_bytes())),
    }
}

/// The key half of a record: a chord's names, or - under the secure predicate, for one
/// printable key with no modifier or with Shift alone - text of length 1 and no names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeysRecord {
    pub keys: Option<Vec<String>>,
    pub text: Option<TextRecord>,
    pub redacted: bool,
}

#[must_use]
pub fn keys(chord: &[String], secure: bool) -> KeysRecord {
    let printable: Vec<&String> = chord.iter().filter(|key| !is_shift(key)).collect();
    let single_printable = matches!(printable.as_slice(), [key] if key.chars().count() == 1);
    if secure && single_printable {
        return KeysRecord {
            keys: None,
            text: Some(TextRecord {
                length: 1,
                sha256_16: None,
            }),
            redacted: true,
        };
    }
    KeysRecord {
        keys: (!chord.is_empty()).then(|| chord.to_vec()),
        text: None,
        redacted: false,
    }
}

fn is_shift(key: &str) -> bool {
    key.eq_ignore_ascii_case("shift")
}

/// Strings over [`MAX_CHARS`] end in `...[truncated N]`.
#[must_use]
pub fn truncate(value: &str) -> String {
    let count = value.chars().count();
    if count <= MAX_CHARS {
        return value.to_owned();
    }
    let kept: String = value.chars().take(MAX_CHARS).collect();
    format!("{kept}...[truncated {}]", count - MAX_CHARS)
}
