//! Rows of `ControlRequired`: the grant, consent, scope, authority and lease reasons.

use super::{
    make, ComputerCode, EngineCode, ErrorRow, NextCall, NothingSent, Reason, Source,
    NOTHING_FOLLOWS,
};
use super::{ASK, INSPECT, NDAU, NDS};

pub(super) static ROWS: &[ErrorRow] = &[
    e!(ControlRequired, _ => ControlRequired, NDAU, Yes, ASK, "win.setFrame(frame)"),
    e!(ControlRequired, Foreground => ControlRequired, NDAU, Yes, ASK, "win.setFrame(frame)"),
    e!(ControlRequired, HeadlessHost => ControlRequired, NDAU, Yes, ASK, "win.setFrame(frame)"),
    e!(ControlRequired, AppScope => ControlRequired, NDAU, Yes, ASK, "win.setFrame(frame)"),
    e!(ControlRequired, DeniedThisTurn => ControlRequired, NDAU, Yes, ASK, none),
    e!(ControlRequired, ConsentOff => ControlRequired, NDAU, Yes, ASK, "computer.hands()"),
    e!(ControlRequired, UserStopped => ControlRequired, NDAU, Yes, ASK, "another app or stop"),
    e!(ControlRequired, SpawnInsideSession => ControlRequired, NDAU, Yes, ASK, none),
    e!(ControlRequired, AttachInsideSession => ControlRequired, NDAU, Yes, ASK, none),
    e!(ControlRequired, NeedsObserve => ControlRequired, NDS, Yes, INSPECT, "win.observe()"),
    e!(ControlRequired, AuthorityChanged => ControlRequired, NDS, Yes, INSPECT, "win.observe()"),
    e!(ControlRequired, PermissionChanged => ControlRequired, NDAU, Yes, ASK, "computer.hands()"),
    e!(ControlRequired, Tampered => ControlRequired, NDAU, Yes, ASK, "computer.hands()"),
    e!(ControlRequired, LeaseMissing => ControlRequired, NDAU, Yes, ASK, "win.setFrame(frame)"),
    e!(ControlRequired, DisplayAsleep => ControlRequired, NDAU, Yes, ASK, "the same call with delivery: \"background\""),
    e!(ControlRequired, ProviderSafetyCheck => ControlRequired, NDAU, Yes, ASK, none),
    e!(ControlRequired, UrlPolicy => ControlRequired, NDAU, Yes, ASK, none),
    e!(ControlRequired, IdentityChanged => ControlRequired, NDAU, Yes, ASK, none),
    e!(ControlRequired, NoPresenceSurface => PresenceUnavailable, NDAU, Yes, ASK, "background verbs"),
    e!(ControlRequired, WaylandNoEscape => PresenceUnavailable, NDAU, Yes, ASK, "background verbs"),
    e!(ControlRequired, DeniedApp => ControlRequired, NDAU, Yes, ASK, "another app or stop"),
    e!(ControlRequired, OriginUnattended => ControlRequired, NDAU, Yes, ASK, "computer.hands()"),
    e!(ControlRequired, Rebased => ControlRequired, NDAU, Yes, ASK, "computer.hands()"),
];
