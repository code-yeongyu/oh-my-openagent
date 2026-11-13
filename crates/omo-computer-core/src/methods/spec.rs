//! The columns of a method-table row.

use serde::Serialize;

use super::table::Method;

/// What a method may do to the desktop or to the engine's input gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    /// Observes, or only narrows what the engine may do.
    Read,
    /// Acts on the desktop or widens what the engine may do.
    Exec,
}

/// Which host connection a host-only method is admitted from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PeerKind {
    /// Every `hand.ensure`-registered peer.
    Session,
    /// Only the spawning host's and the launcher's connections; another peer is refused
    /// `-32601 hostOnly{peer_kind:"attach_host"}`.
    Authority,
}

/// Who may call a method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exposure {
    /// Any client, bridges such as `--oneshot` included.
    Public,
    /// A host connection of the given kind; bridges refuse it.
    HostOnly(PeerKind),
    /// Only while the fake clock is installed.
    TestOnly,
}

impl Exposure {
    /// The spelling the schema and the doc use: `public`, `hostOnly(session)`, ...
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Public => "public",
            Self::HostOnly(PeerKind::Session) => "hostOnly(session)",
            Self::HostOnly(PeerKind::Authority) => "hostOnly(authority)",
            Self::TestOnly => "testOnly",
        }
    }
}

/// One row of the method table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MethodSpec {
    pub method: Method,
    pub name: &'static str,
    pub effect: Effect,
    pub exposure: Exposure,
    /// The params type as the table writes it.
    pub params: &'static str,
    /// The result type as the table writes it.
    pub result: &'static str,
}
