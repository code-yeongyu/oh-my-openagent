//! Rows of the failures raised outside the engine's code table: the JSON-RPC layer, the
//! hand host and transport, the SDK, the run cell, the tool and the provider adapter.

use super::{
    make, ComputerCode, ErrorRow, LayerFailure, NextCall, NothingSent, Reason, Source,
    NOTHING_FOLLOWS,
};
use super::{ASK, DUU, INSPECT, NDAU, NDS, RUN, UNK};

pub(super) static ROWS: &[ErrorRow] = &[
    l!(PermissionRuleDenied, _ => PermissionDenied, NDAU, Yes, ASK, none),
    l!(InvalidArguments, _ => InvalidArguments, NDS, Yes, INSPECT, "the same call with the arguments the message names"),
    l!(InvalidArguments, SessionEnded => InvalidArguments, NDS, Yes, INSPECT, "computer.capabilities()"),
    l!(MethodNotFound, _ => InvalidArguments, NDS, Yes, INSPECT, "computer.capabilities()"),
    l!(MalformedMessage, _ => Internal, UNK, No, None, "win.observe()"),
    l!(MalformedReport, _ => Internal, UNK, No, None, "win.observe()"),
    l!(HandCrashed, _ => HandCrashed, DUU, No, None, "computer.hands()"),
    l!(HandCrashed, EngineExited => HandCrashed, DUU, No, None, "computer.hands()"),
    l!(HandCrashed, HandExited => HandCrashed, DUU, No, None, "computer.hands()"),
    l!(HandOffline, _ => HandOffline, NDS, Yes, INSPECT, "computer.hands({ online: true })"),
    l!(HandOffline, Unreachable => HandOffline, NDS, Yes, INSPECT, "computer.hands({ online: true })"),
    l!(HandOffline, NoBridge => HandOffline, NDS, Yes, INSPECT, "computer.hands({ online: true })"),
    l!(HandOffline, NotInteractive => HandOffline, NDS, Yes, INSPECT, "computer.hands({ online: true })"),
    l!(HandOffline, Unmeasured => HandOffline, NDS, Yes, INSPECT, "computer.hands({ online: true })"),
    l!(LinkDegraded, _ => LinkDegraded, NDS, Yes, INSPECT, "win.observe()"),
    l!(TransportLost, _ => TransportLost, DUU, Depends, None, "computer.hands()"),
    l!(RemoteCommandsDisabled, _ => RemoteCommandsDisabled, NDAU, Yes, ASK, none),
    l!(EntitlementRequired, _ => EntitlementRequired, NDAU, Yes, ASK, "computer.hands()"),
    l!(ProtocolMismatch, _ => ProtocolMismatch, NDAU, Yes, ASK, "computer.hands()"),
    l!(ProtocolMismatch, AbiMismatch => ProtocolMismatch, NDAU, Yes, ASK, "computer.hands()"),
    l!(FeatureUnavailable, _ => FeatureUnavailable, NDS, Yes, INSPECT, "computer.hands()"),
    l!(HandOutdated, _ => HandOutdated, NDAU, Yes, ASK, "computer.diagnose({ hand })"),
    l!(UnsupportedAction, _ => UnsupportedAction, NDS, Yes, INSPECT, "the same batch with documented action members"),
    l!(SafetyCheckDeclined, _ => SafetyCheckDeclined, NDAU, Yes, ASK, none),
    l!(Disabled, _ => Disabled, NDAU, Yes, ASK, none),
    l!(SecureFocus, _ => SecureFocus, NDAU, Yes, ASK, "win.type(text)"),
    l!(SecureFocus, ConcealedClipboard => SecureFocus, NDAU, Yes, ASK, "win.type(text)"),
    l!(LaunchContextRequired, _ => LaunchContextRequired, NDAU, Yes, ASK, "computer.diagnose()"),
    l!(RunLimit, _ => RunLimit, RUN, Depends, None, "a smaller body, or run_sandbox=vm"),
    l!(RunLimit, HostGlobal => RunLimit, RUN, Depends, None, "a smaller body, or run_sandbox=vm"),
    l!(RunFailed, _ => RunLimit, RUN, Depends, None, "the fixed body, with cell values in args"),
    l!(RunFailed, BodyThrew => RunLimit, RUN, Depends, None, "the fixed body, with cell values in args"),
];
