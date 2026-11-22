//! The scripts keyed on the end of a call: identity changes, epoch events and display changes.

use serde::Deserialize;

use super::records::FakeDisplay;
use crate::method::FakeMethod;

const fn first() -> u32 {
    1
}

/// After the `nth` call of `after_call`, the window's process is replaced.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdentityChange {
    pub after_call: FakeMethod,
    #[serde(default = "first")]
    pub nth: u32,
    pub window: String,
    pub new_pid: u32,
    #[serde(rename = "new_processStart")]
    pub new_process_start: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EpochReason {
    Display,
    Scale,
    Lock,
    Sleep,
    Space,
    Session,
    InputDesktop,
    StreamGeometry,
    EngineRestart,
    IdleFlush,
}

impl EpochReason {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Display => "display",
            Self::Scale => "scale",
            Self::Lock => "lock",
            Self::Sleep => "sleep",
            Self::Space => "space",
            Self::Session => "session",
            Self::InputDesktop => "input_desktop",
            Self::StreamGeometry => "stream_geometry",
            Self::EngineRestart => "engine_restart",
            Self::IdleFlush => "idle_flush",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EpochEvent {
    pub after_call: FakeMethod,
    #[serde(default = "first")]
    pub nth: u32,
    pub reason: EpochReason,
}

/// After the `nth` call of `after_call` the display set becomes `displays`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplaysChange {
    pub after_call: FakeMethod,
    #[serde(default = "first")]
    pub nth: u32,
    pub displays: Vec<FakeDisplay>,
}
