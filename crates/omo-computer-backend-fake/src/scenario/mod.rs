//! The scenario format.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidKind {
    Syntax,
    UnknownKey,
    Shape,
    Reference,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioInvalid {
    pub kind: InvalidKind,
    pub pointer: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FakeScenario {
    pub displays: Vec<()>,
}

impl FakeScenario {
    /// # Errors
    /// Always, in this signature stub.
    pub fn from_json(json: &str) -> Result<Self, ScenarioInvalid> {
        let _ = json;
        Err(ScenarioInvalid {
            kind: InvalidKind::Shape,
            pointer: String::new(),
            reason: "not loaded".to_owned(),
        })
    }

    /// # Errors
    /// Always, in this signature stub.
    pub fn load(path: &Path) -> Result<Self, ScenarioInvalid> {
        let _ = path;
        Self::from_json("")
    }
}

#[must_use]
pub fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

#[cfg(test)]
mod tests;
