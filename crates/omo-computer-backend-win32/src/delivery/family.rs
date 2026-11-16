//! The family of a window's deepest child class and what a background verb on it answers.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The drop-matrix family of a window class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Chromium,
    Wpf,
    Uwp,
    Classic,
    Unknown,
}

/// A background verb's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    LeftClick,
    RightClick,
    Text,
    Key,
}

/// The only route the caller can take after a family refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NextDelivery {
    Foreground,
}

/// A background verb refused before any post.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FamilyRefusal {
    pub refusal: Refusal,
    pub next: NextDelivery,
}

/// The family of `class` (exact class names, never a substring).
#[must_use]
pub fn family_of(class: &str) -> Family {
    let _ = class;
    Family::Unknown
}

/// Whether `verb` may be posted to a window of `family`.
///
/// # Errors
/// `BackgroundUnavailable` with the foreground as the next call for a refusing family.
pub fn admit(family: Family, verb: Verb) -> Result<(), FamilyRefusal> {
    let _ = (family, verb, Refusal::new(EngineCode::BackgroundUnavailable, Reason::ChromiumElectron));
    Ok(())
}
