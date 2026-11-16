//! The family of a window's deepest child class and what a background verb on it answers: the
//! drop matrix ([`super::matrix`]) decides, and a refusal sends nothing and names the foreground as
//! the only next delivery (never a silent fallback to it).

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::matrix::{rows, Row};

/// The drop-matrix family of a window class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Chromium,
    Wpf,
    Uwp,
    WinUi3,
    Tk,
    Gtk,
    Vcl,
    Terminal,
    Classic,
    /// The Direct2D rich edit (`RichEditD2DPT`, the Windows 11 Notepad edit): refused until the
    /// spike measures it (its posted `WM_CHAR` row hit classic `Edit`); owed to row 69.
    RichEditD2d,
    Unknown,
}

impl Family {
    /// The family of a `matrix.tsv` row.
    #[must_use]
    pub fn from_wire(wire: &str) -> Option<Self> {
        Some(match wire {
            "chromium" => Self::Chromium,
            "wpf" => Self::Wpf,
            "uwp" => Self::Uwp,
            "winui3" => Self::WinUi3,
            "tk" => Self::Tk,
            "gtk" => Self::Gtk,
            "vcl" => Self::Vcl,
            "terminal" => Self::Terminal,
            "classic" => Self::Classic,
            "richedit_d2d" => Self::RichEditD2d,
            _ => return None,
        })
    }

    const fn reason(self) -> Reason {
        match self {
            Self::Chromium => Reason::ChromiumElectron,
            _ => Reason::Toolkit,
        }
    }
}

/// A background verb's kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    LeftClick,
    RightClick,
    MiddleClick,
    Move,
    Scroll,
    Text,
    Key,
    /// A chord holding Shift (on a non-character key), Ctrl or Win: a posted message is not key
    /// state, so every family drops it (the per-route `chord_modifier` row).
    ModifierChord,
}

impl Verb {
    pub const ALL: [Self; 8] = [
        Self::LeftClick,
        Self::RightClick,
        Self::MiddleClick,
        Self::Move,
        Self::Scroll,
        Self::Text,
        Self::Key,
        Self::ModifierChord,
    ];

    /// The verb of a `matrix.tsv` list entry.
    #[must_use]
    pub fn from_wire(wire: &str) -> Option<Self> {
        Some(match wire {
            "left_click" => Self::LeftClick,
            "right_click" => Self::RightClick,
            "middle_click" => Self::MiddleClick,
            "move" => Self::Move,
            "scroll" => Self::Scroll,
            "text" => Self::Text,
            "key" => Self::Key,
            "chord_modifier" => Self::ModifierChord,
            _ => return None,
        })
    }
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

/// The family of `class` (exact class names or `*` prefixes, never a substring).
#[must_use]
pub fn family_of(class: &str) -> Family {
    rows()
        .unwrap_or_default()
        .iter()
        .find_map(|row| row.family.filter(|_| row.matches(class)))
        .unwrap_or(Family::Unknown)
}

/// Whether `verb` may be posted to a window of `family`.
///
/// # Errors
/// `BackgroundUnavailable` (`chromium_electron`, `toolkit`, or `posted_modifier_chord` for the
/// per-route row) with the foreground as the next call, nothing sent.
pub fn admit(family: Family, verb: Verb) -> Result<(), FamilyRefusal> {
    admit_in(rows(), family, verb)
}

/// [`admit`] over `table`, `None` for a matrix that failed to load.
///
/// # Errors
/// As [`admit`]; a matrix that failed to load refuses every verb.
pub fn admit_in(table: Option<&[Row]>, family: Family, verb: Verb) -> Result<(), FamilyRefusal> {
    let Some(table) = table else {
        return Err(FamilyRefusal {
            refusal: Refusal::new(
                EngineCode::BackgroundUnavailable,
                Reason::PostedModifierChord,
            ),
            next: NextDelivery::Foreground,
        });
    };
    let dropped = table
        .iter()
        .find(|row| row.family.is_none_or(|of| of == family) && row.refused.contains(&verb));
    match dropped {
        None => Ok(()),
        Some(row) => {
            let reason = if row.family.is_none() {
                Reason::PostedModifierChord
            } else {
                family.reason()
            };
            Err(FamilyRefusal {
                refusal: Refusal::new(EngineCode::BackgroundUnavailable, reason),
                next: NextDelivery::Foreground,
            })
        }
    }
}
