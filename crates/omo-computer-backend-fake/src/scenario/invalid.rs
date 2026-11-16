//! The typed scenario refusal and the JSON pointer it names.

use std::fmt;

use serde_json::Value;

use super::FakeScenario;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidKind {
    /// The file cannot be read.
    Read,
    /// Not JSON.
    Syntax,
    /// A key the format does not have.
    UnknownKey,
    /// A value of the wrong type, a missing member or an unknown enum value.
    Shape,
    /// A member that names a window the scenario does not list, or an impossible count.
    Reference,
}

/// A scenario the loader refuses; no backend is built from it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioInvalid {
    pub kind: InvalidKind,
    /// RFC 6901 pointer of the offending member; empty for the document.
    pub pointer: String,
    pub reason: String,
}

impl fmt::Display for ScenarioInvalid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ScenarioInvalid{{pointer:{:?}}}: {}",
            self.pointer, self.reason
        )
    }
}

impl std::error::Error for ScenarioInvalid {}

pub(super) fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// The backtick-quoted names of a serde message, in order.
fn quoted(message: &str) -> Vec<String> {
    message
        .split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_owned)
        .collect()
}

/// The first object (document order) holding `key` whose other keys are all `expected`.
fn locate_key(value: &Value, key: &str, expected: &[String], path: &str) -> Option<String> {
    match value {
        Value::Object(map) => {
            let siblings_fit = map
                .keys()
                .filter(|name| name.as_str() != key)
                .all(|name| expected.is_empty() || expected.contains(name));
            if map.contains_key(key) && siblings_fit {
                return Some(format!("{path}/{}", escape(key)));
            }
            map.iter().find_map(|(name, child)| {
                locate_key(child, key, expected, &format!("{path}/{}", escape(name)))
            })
        }
        Value::Array(items) => items.iter().enumerate().find_map(|(index, child)| {
            locate_key(child, key, expected, &format!("{path}/{index}"))
        }),
        _ => None,
    }
}

/// The first string leaf (document order) equal to `text`.
fn locate_string(value: &Value, text: &str, path: &str) -> Option<String> {
    match value {
        Value::String(leaf) if leaf == text => Some(path.to_owned()),
        Value::Object(map) => map.iter().find_map(|(name, child)| {
            locate_string(child, text, &format!("{path}/{}", escape(name)))
        }),
        Value::Array(items) => items
            .iter()
            .enumerate()
            .find_map(|(index, child)| locate_string(child, text, &format!("{path}/{index}"))),
        _ => None,
    }
}

pub(super) fn from_serde(value: &Value, error: &serde_json::Error) -> ScenarioInvalid {
    let reason = error.to_string();
    let names = quoted(&reason);
    let located = match names.split_first() {
        Some((key, expected)) if reason.starts_with("unknown field") => {
            locate_key(value, key, expected, "").map(|pointer| (InvalidKind::UnknownKey, pointer))
        }
        Some((variant, _)) if reason.starts_with("unknown variant") => {
            locate_string(value, variant, "").map(|pointer| (InvalidKind::Shape, pointer))
        }
        _ => None,
    };
    let (kind, pointer) = located.unwrap_or((InvalidKind::Shape, String::new()));
    ScenarioInvalid {
        kind,
        pointer,
        reason,
    }
}

/// Every top-level key the format accepts, read from the loader itself.
#[must_use]
pub fn field_names() -> Vec<String> {
    let probe = serde_json::json!({ "\u{1}": 0 });
    match serde::Deserialize::deserialize(&probe).map(|_: FakeScenario| ()) {
        Ok(()) => Vec::new(),
        Err(error) => quoted(&error.to_string()).into_iter().skip(1).collect(),
    }
}
