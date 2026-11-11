//! The redaction table (RED stub: keeps a digest always).

use super::line::TextRecord;

#[must_use]
pub fn text(value: &str, _secure: bool) -> TextRecord {
    TextRecord { length: value.len(), sha256_16: Some(String::new()) }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeysRecord {
    pub keys: Option<Vec<String>>,
    pub text: Option<TextRecord>,
    pub redacted: bool,
}

#[must_use]
pub fn keys(chord: &[String], _secure: bool) -> KeysRecord {
    KeysRecord { keys: Some(chord.to_vec()), text: None, redacted: false }
}
