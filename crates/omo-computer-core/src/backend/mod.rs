//! The `Backend` / `AxBackend` traits every OS backend and the fake implement. Every method
//! has a refusing default, so a backend overrides exactly what it supports and the rest
//! answers a typed refusal with nothing sent. The session calls `post_input` only from
//! `mutate()`: it is the one side-effect sink.

mod refusal;
mod refusing;
mod sources;
mod types;

pub use refusal::{BackendResult, Refusal};
pub use refusing::{refusing_capabilities, unknown_session_state};
pub use sources::{AxEventSource, EpochSource, NoAxEvents, NoEpochSource, Presence, StopListener};
pub use types::{
    AxEvent, AxSnapshot, CaptureOptions, Delivered, EpochChange, FrameBytes, InputEvent,
    PermissionProbe, Ref, Resolved, Route, Semantic, SnapshotRequest, TaggedInput, Target,
    WindowFilter, WindowList,
};

use crate::capabilities::Capabilities;
use crate::error::{EngineCode, Reason};
use crate::results::{DisplayInfo, PermissionState};

/// The desktop backend of one OS (or the fake).
pub trait Backend: Send {
    /// `{available, reason}` per capability; never prompts.
    fn capabilities(&self) -> Capabilities {
        refusing_capabilities()
    }

    /// # Errors
    /// `Internal{windows_unsupported}` (`COMPUTER_UNAVAILABLE`) by default.
    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        let _ = filter;
        Err(Refusal::new(EngineCode::Internal, "windows_unsupported"))
    }

    /// # Errors
    /// `Internal{displays_unsupported}` (`COMPUTER_UNAVAILABLE`) by default.
    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        Err(Refusal::new(EngineCode::Internal, "displays_unsupported"))
    }

    /// # Errors
    /// `CaptureUnavailable{capture_unsupported}` by default.
    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        let _ = (target, options);
        Err(Refusal::new(
            EngineCode::CaptureUnavailable,
            "capture_unsupported",
        ))
    }

    /// The one side-effect sink.
    ///
    /// # Errors
    /// `Internal{input_unsupported}` (`COMPUTER_UNAVAILABLE`) by default, with nothing sent.
    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        let _ = (input, route);
        Err(Refusal::new(EngineCode::Internal, "input_unsupported"))
    }

    /// A listen-only, injected-immune stop listener.
    ///
    /// # Errors
    /// `StopPathUnavailable{no_listener}` by default.
    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        Err(Refusal::new(EngineCode::StopPathUnavailable, "no_listener"))
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

    /// The presence surface; `None` reads `ControlRequired{no_presence_surface}` (`COMPUTER_PRESENCE_UNAVAILABLE`).
    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        None
    }

    /// The accessibility reads the observation model walks and re-identifies through; `None`
    /// reads `AxUnsupported{snapshot_unsupported}`.
    fn ax_reader(&mut self) -> Option<&mut dyn crate::ax::AxReader> {
        None
    }

    // --- Row 21: consent bound to code identity, and the host's consent view. ---

    /// The signed code identity of `pid`'s executable, read without prompting. `None` is
    /// `identity_unavailable`: a consent entry then binds to the path alone.
    fn code_identity(&self, pid: u32) -> Option<crate::listing::CodeIdentity> {
        let _ = pid;
        None
    }

    /// The executable path of `pid`, read without prompting. `None`: the path is unknown, and a
    /// consent entry with no readable identity then has nothing to bind to.
    fn executable_path(&self, pid: u32) -> Option<String> {
        let _ = pid;
        None
    }

    /// The platform this backend drives (A-IS-62 rev 5, R70an): its OS's documented defaults
    /// apply. `None` (the default) is the host's OS; the fake answers its persona.
    fn platform(&self) -> Option<crate::report::Platform> {
        None
    }

    /// The consent view the hand tool host hands the engine at `session.open`, as the host
    /// wrote it (`design/d-safety.md` '## Approval and consent'). `None`: no host view, and the
    /// session keeps its default view.
    fn host_consent(&self) -> Option<serde_json::Value> {
        None
    }

    /// The chord the next `stop_listener` arms, `None` the backend's own. Fed only by the consent
    /// view's `stopHotkey` (A-IS-62). By default only [`DEFAULT_STOP_CHORD`] is taken.
    ///
    /// # Errors
    /// `StopPathUnavailable{deaf}` by default for any other chord, nothing armed (A-IS-62).
    fn set_stop_chord(&mut self, chord: Option<&str>) -> BackendResult<()> {
        match chord {
            Some(chord) if !chord.eq_ignore_ascii_case(DEFAULT_STOP_CHORD) => Err(Refusal::new(
                EngineCode::StopPathUnavailable,
                Reason::Deaf.wire(),
            )),
            _ => Ok(()),
        }
    }
}

/// The accessibility half of a backend.
pub trait AxBackend {
    /// # Errors
    /// `AxUnsupported{snapshot_unsupported}` by default.
    fn snapshot(&mut self, request: &SnapshotRequest) -> BackendResult<AxSnapshot> {
        let _ = request;
        Err(Refusal::new(
            EngineCode::AxUnsupported,
            "snapshot_unsupported",
        ))
    }

    /// # Errors
    /// `AxUnsupported{resolve_unsupported}` by default.
    fn resolve(&mut self, reference: &Ref) -> BackendResult<Resolved> {
        let _ = reference;
        Err(Refusal::new(
            EngineCode::AxUnsupported,
            "resolve_unsupported",
        ))
    }

    /// # Errors
    /// `AxUnsupported{perform_unsupported}` by default, with nothing sent.
    fn perform(&mut self, reference: &Ref, action: &Semantic) -> BackendResult<Delivered> {
        let _ = (reference, action);
        Err(Refusal::new(
            EngineCode::AxUnsupported,
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
    Refusal::new(EngineCode::ControlRequired, "no_presence_surface");

/// The stop chord a backend on the `set_stop_chord` default listens for: the X11, Wayland and
/// Windows default `computer.stopHotkey` (`design/d-safety.md` '1. The physical stop chord').
pub const DEFAULT_STOP_CHORD: &str = "ctrl+alt+shift+escape";

#[cfg(test)]
mod stop_chord_tests {
    use super::{Backend, Refusal, DEFAULT_STOP_CHORD};
    use crate::error::{EngineCode, Reason};

    /// A backend on every default.
    struct Defaults;

    impl Backend for Defaults {}

    #[test]
    fn a_default_backend_refuses_a_foreign_stop_chord_and_takes_its_own() {
        let mut backend = Defaults;
        assert_eq!(
            backend.set_stop_chord(Some("ctrl+alt+a")),
            Err(Refusal::new(EngineCode::StopPathUnavailable, Reason::Deaf.wire())),
            "A-IS-62: a chord it cannot arm reads deaf, never a bare or other refusal"
        );
        assert_eq!(
            backend.stop_listener().err(),
            Some(Refusal::new(EngineCode::StopPathUnavailable, "no_listener")),
            "no listener is armed for the refused chord"
        );
        assert_eq!(backend.set_stop_chord(Some(DEFAULT_STOP_CHORD)), Ok(()));
        assert_eq!(backend.set_stop_chord(None), Ok(()), "none: its own");
    }
}
