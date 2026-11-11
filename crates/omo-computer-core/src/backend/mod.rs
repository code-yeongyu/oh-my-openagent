//! The `Backend` / `AxBackend` traits every OS backend and the fake implement. Every method
//! has a refusing default, so a backend overrides exactly what it supports and the rest
//! answers a typed refusal with nothing sent. The session calls `post_input` only from
//! `mutate()`: it is the one side-effect sink.

mod refusal;
mod refusing;
mod sources;
mod types;

pub use refusal::{BackendResult, Refusal, RefusalCode};
pub use refusing::{refusing_capabilities, unknown_session_state};
pub use sources::{AxEventSource, EpochSource, NoAxEvents, NoEpochSource, Presence, StopListener};
pub use types::{
    AxEvent, AxSnapshot, CaptureOptions, Delivered, EpochChange, FrameBytes, InputEvent,
    PermissionProbe, Ref, Resolved, Route, Semantic, SnapshotRequest, TaggedInput, Target,
    WindowFilter, WindowList,
};

use crate::capabilities::Capabilities;
use crate::results::{DisplayInfo, PermissionState};

/// The desktop backend of one OS (or the fake).
pub trait Backend: Send {
    /// `{available, reason}` per capability; never prompts.
    fn capabilities(&self) -> Capabilities {
        refusing_capabilities()
    }

    /// # Errors
    /// `Unavailable{windows_unsupported}` by default.
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        let _ = filter;
        Err(Refusal::new(
            RefusalCode::Unavailable,
            "windows_unsupported",
        ))
    }

    /// # Errors
    /// `Unavailable{displays_unsupported}` by default.
    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        Err(Refusal::new(
            RefusalCode::Unavailable,
            "displays_unsupported",
        ))
    }

    /// # Errors
    /// `CaptureUnavailable{capture_unsupported}` by default.
    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        let _ = (target, options);
        Err(Refusal::new(
            RefusalCode::CaptureUnavailable,
            "capture_unsupported",
        ))
    }

    /// The one side-effect sink.
    ///
    /// # Errors
    /// `Unavailable{input_unsupported}` by default, with nothing sent.
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        let _ = (input, route);
        Err(Refusal::new(RefusalCode::Unavailable, "input_unsupported"))
    }

    /// A listen-only, injected-immune stop listener.
    ///
    /// # Errors
    /// `StopPathUnavailable{no_listener}` by default.
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        Err(Refusal::new(
            RefusalCode::StopPathUnavailable,
            "no_listener",
        ))
    }

    /// The tri-state permission read; never prompts. Unknown by default, which is never granted.
    fn probe_permissions(&self) -> PermissionProbe {
        PermissionProbe {
            capture: PermissionState::Unknown,
            input: PermissionState::Unknown,
            accessibility: PermissionState::Unknown,
        }
    }

    /// The epoch source; by default one whose every read refuses.
    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        Box::new(NoEpochSource)
    }

    /// The presence surface; `None` reads `PresenceUnavailable`.
    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        None
    }
}

/// The accessibility half of a backend.
pub trait AxBackend {
    /// # Errors
    /// `AxUnavailable{snapshot_unsupported}` by default.
    fn snapshot(&mut self, request: &SnapshotRequest) -> BackendResult<AxSnapshot> {
        let _ = request;
        Err(Refusal::new(
            RefusalCode::AxUnavailable,
            "snapshot_unsupported",
        ))
    }

    /// # Errors
    /// `AxUnavailable{resolve_unsupported}` by default.
    fn resolve(&mut self, reference: &Ref) -> BackendResult<Resolved> {
        let _ = reference;
        Err(Refusal::new(
            RefusalCode::AxUnavailable,
            "resolve_unsupported",
        ))
    }

    /// # Errors
    /// `AxUnavailable{perform_unsupported}` by default, with nothing sent.
    fn perform(&mut self, reference: &Ref, action: &Semantic) -> BackendResult<Delivered> {
        let _ = (reference, action);
        Err(Refusal::new(
            RefusalCode::AxUnavailable,
            "perform_unsupported",
        ))
    }

    /// The observer events; by default a source whose every read refuses.
    fn events(&mut self) -> Box<dyn AxEventSource> {
        Box::new(NoAxEvents)
    }
}

/// The refusal a missing presence surface reads as.
pub const PRESENCE_UNAVAILABLE: Refusal =
    Refusal::new(RefusalCode::PresenceUnavailable, "no_presence_surface");
