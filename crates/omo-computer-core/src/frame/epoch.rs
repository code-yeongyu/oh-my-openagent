//! The reasons the session epoch moves. A move supersedes every frame and expires every ref.

use serde::Serialize;

/// `epoch.changed{reason}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EpochReason {
    /// Display reconfiguration (added, removed, moved).
    Display,
    /// A display's scale changed.
    Scale,
    /// Lock or unlock.
    Lock,
    /// Sleep or wake.
    Sleep,
    /// A Space switch (macOS).
    Space,
    /// A Windows session change or a console switch.
    Session,
    /// The Windows input desktop changed.
    InputDesktop,
    /// A Wayland stream's geometry changed.
    StreamGeometry,
    /// The engine restarted (the host emits it on reconnect).
    EngineRestart,
    /// The idle flush.
    IdleFlush,
}

impl EpochReason {
    pub const ALL: [Self; 10] = [
        Self::Display,
        Self::Scale,
        Self::Lock,
        Self::Sleep,
        Self::Space,
        Self::Session,
        Self::InputDesktop,
        Self::StreamGeometry,
        Self::EngineRestart,
        Self::IdleFlush,
    ];

    #[must_use]
    pub const fn wire(self) -> &'static str {
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

    /// The reason spelled `wire`, if any.
    #[must_use]
    pub fn from_wire(wire: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|reason| reason.wire() == wire)
    }
}
