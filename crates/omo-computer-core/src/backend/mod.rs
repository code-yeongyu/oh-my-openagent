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
use crate::error::EngineCode;
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

    /// The backend's monotonic clock and its wait; `None` (the default) when it has none,
    /// which makes an admission that would pause answer at once instead.
    fn clock(&self) -> Option<&dyn crate::intervention::BackendClock> {
        None
    }

    /// The reads the takeover gate, the mid-send watch and target liveness take; `None` (the
    /// default) when the backend has no foreign-input filter or liveness probe.
    fn intervention(&self) -> Option<&dyn crate::intervention::InterventionSource> {
        None
    }

    /// The keys the user holds physically, which a release never lifts (row 23); empty (the
    /// default) when the backend cannot tell them apart.
    fn user_held_keys(&self) -> Vec<String> {
        Vec::new()
    }

    /// The pointer's point, read without posting anything (`pointer()`, row 23); `None` (the
    /// default) when the backend cannot read it.
    fn pointer(&self) -> Option<crate::params::Point> {
        None
    }

    /// Row 24 (R56): the accessibility half the value verbs write through; `None` (the default)
    /// refuses every AX write with `AxUnsupported`, nothing sent.
    fn ax(&mut self) -> Option<&mut dyn AxBackend> {
        None
    }

    /// Row 24 (R60): whether a secure field has focus in `window` (or anywhere, for `None`).
    /// `None` answered: unknown (the clipboard gate decides what unknown means).
    fn secure_focus(&self, _window: Option<&str>) -> Option<bool> {
        None
    }

    /// Row 24 (R56): the clipboard, read for `clipboard.read` and for a paste's restore; a
    /// concealed clipboard answers [`crate::clipboard::ClipboardRead::Concealed`] unread.
    ///
    /// # Errors
    /// `Internal{clipboard}` by default: no clipboard route.
    fn clipboard_read(&mut self) -> BackendResult<crate::clipboard::ClipboardRead> {
        Err(Refusal::new(EngineCode::Internal, crate::error::Reason::Clipboard.wire()))
    }

    /// # Errors
    /// `Internal{clipboard}` by default, with nothing written.
    fn clipboard_write(&mut self, _text: &str) -> BackendResult<()> {
        Err(Refusal::new(EngineCode::Internal, crate::error::Reason::Clipboard.wire()))
    }

    /// Row 24: asks the window manager for `frame` and answers what it applied, read back.
    ///
    /// # Errors
    /// `InvalidTarget{window_frame_unavailable}` by default, with nothing sent.
    fn set_frame(&mut self, _window: &str, _frame: crate::listing::Rect) -> BackendResult<crate::window_frame::FrameApplied> {
        Err(Refusal::new(EngineCode::InvalidTarget, crate::error::Reason::WindowFrameUnavailable.wire()))
    }

    /// Row 24 (C8): whether the window's position can be set at all, asked BEFORE a frame write so
    /// an immovable window answers `WindowImmovable` with nothing sent. `None` (the default):
    /// unknown, and the write is sent.
    fn frame_settable(&self, _window: &str) -> Option<bool> {
        None
    }

    /// Row 24: quits the app (`apps.quit`); the gate has already refused the self set and the
    /// protected table.
    ///
    /// # Errors
    /// `AxUnsupported{perform_unsupported}` by default, with nothing sent.
    fn quit_app(&mut self, _app: &str) -> BackendResult<Delivered> {
        Err(Refusal::new(EngineCode::AxUnsupported, crate::error::Reason::PerformUnsupported.wire()))
    }

    /// Row 24: `window.minimize` (`minimize: true`) or `window.restore` (`false`).
    ///
    /// # Errors
    /// `InvalidTarget{window_frame_unavailable}` by default, with nothing sent.
    fn set_minimized(&mut self, _window: &str, _minimize: bool) -> BackendResult<()> {
        Err(Refusal::new(EngineCode::InvalidTarget, crate::error::Reason::WindowFrameUnavailable.wire()))
    }

    /// Types `text` as one stroke that `interrupt` may end between Unicode scalars (asked
    /// before every scalar after the first). The default cannot be interrupted: it sends the
    /// whole text as one `post_input`, exactly as a Text event, and reports every scalar.
    fn post_text(
        &mut self,
        text: &str,
        route: Route,
        tag: u64,
        interrupt: &mut dyn FnMut(&dyn Backend) -> bool,
    ) -> crate::intervention::TextDelivery {
        let _ = interrupt;
        let of = crate::intervention::scalars(text);
        let input = TaggedInput {
            event: InputEvent::Text(text.to_owned()),
            tag,
        };
        match self.post_input(&input, route) {
            Ok(_) => crate::intervention::TextDelivery { sent: of, of, refusal: None, interrupted: false },
            Err(refusal) => crate::intervention::TextDelivery { sent: 0, of, refusal: Some(refusal), interrupted: false },
        }
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

    /// The consent view the hand tool host hands the engine at `session.open`, as the host
    /// wrote it (`design/d-safety.md` '## Approval and consent'). `None`: no host view, and the
    /// session keeps its default view.
    fn host_consent(&self) -> Option<serde_json::Value> {
        None
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

    /// Row 24 (R56): writes `value` into the element (`ax.setValue`).
    ///
    /// # Errors
    /// `AxUnsupported{perform_unsupported}` by default, with nothing sent.
    fn set_value(&mut self, _reference: &Ref, _value: &str) -> BackendResult<Delivered> {
        Err(Refusal::new(EngineCode::AxUnsupported, crate::error::Reason::PerformUnsupported.wire()))
    }

    /// Row 24: reads the element's value back after a write; `Ok(None)` when it has none to
    /// read (the read-back is then `unverifiable`).
    ///
    /// # Errors
    /// `AxUnsupported{resolve_unsupported}` by default.
    fn read_value(&mut self, _reference: &Ref) -> BackendResult<Option<String>> {
        Err(Refusal::new(EngineCode::AxUnsupported, crate::error::Reason::ResolveUnsupported.wire()))
    }

    /// Row 24: inserts `text` into a native text field at its caret (`ax.typeText` by insertion).
    ///
    /// # Errors
    /// `AxUnsupported{perform_unsupported}` by default (the caller then focuses and types keys).
    fn insert_text(&mut self, _reference: &Ref, _text: &str) -> BackendResult<Delivered> {
        Err(Refusal::new(EngineCode::AxUnsupported, crate::error::Reason::PerformUnsupported.wire()))
    }

    /// Row 24: selects `range` (UTF-16 units) inside the element's value (`ax.selectText`).
    ///
    /// # Errors
    /// `AxUnsupported{perform_unsupported}` by default, with nothing sent.
    fn select_range(&mut self, _reference: &Ref, _range: crate::text_range::Utf16Range) -> BackendResult<Delivered> {
        Err(Refusal::new(EngineCode::AxUnsupported, crate::error::Reason::PerformUnsupported.wire()))
    }

    /// Row 24: focuses the element (`ax.focus`).
    ///
    /// # Errors
    /// `AxUnsupported{perform_unsupported}` by default, with nothing sent.
    fn focus(&mut self, _reference: &Ref) -> BackendResult<Delivered> {
        Err(Refusal::new(EngineCode::AxUnsupported, crate::error::Reason::PerformUnsupported.wire()))
    }

    /// The observer events; by default a source whose every read refuses.
    fn events(&mut self) -> Box<dyn AxEventSource> {
        Box::new(NoAxEvents)
    }
}

/// The refusal a missing presence surface reads as.
pub const PRESENCE_UNAVAILABLE: Refusal =
    Refusal::new(EngineCode::ControlRequired, "no_presence_surface");