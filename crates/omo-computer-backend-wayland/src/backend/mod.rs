//! The Wayland backend: libei input through the portal or `LIBEI_SOCKET`, gated by SP-W's
//! release proof for the compositor the ladder named.

mod env;
mod report;
mod send;

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use omo_computer_core::backend::{Backend, BackendResult, Delivered, Refusal, Route, TaggedInput};
use omo_computer_core::capabilities::{Availability, Capabilities, CompositorName};
use omo_computer_core::clipboard::ClipboardRead;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::params::Point;

pub use report::InputReport;

use crate::clipboard::{self, ClipboardIo, ClipboardRoute};
use crate::consent::Consent;
use crate::input::{describe, EisFd, Input, Link};
use crate::ledger::{Ledger, ReleaseProof};
use crate::portal::RemoteDesktop;
use crate::release::{self, VerbKind};

/// The `OMO_COMPUTER_BACKEND` value that selects this backend.
pub const WAYLAND_BACKEND: &str = "wayland";

/// How the engine reaches the compositor's EIS server.
pub enum InputRoute {
    /// `LIBEI_SOCKET`: CI, kiosks, a compositor exposing an EIS socket.
    Socket(PathBuf),
    /// One combined RemoteDesktop portal session and its `ConnectToEIS`.
    Portal(Box<dyn RemoteDesktop>),
    /// Neither: input is advertised unavailable.
    Unavailable,
}

/// What the backend is built from.
pub struct Options {
    pub compositor: CompositorName,
    pub route: InputRoute,
    pub ledger: Ledger,
    /// `computer.wayland_persist_consent`; `false` until the owner rules (X10).
    pub persist_consent: bool,
    /// The 0600 no-follow state file a persisted token would live in.
    pub consent_file: PathBuf,
    /// The data-control clipboard, when the compositor offers one.
    pub clipboard: Option<Box<dyn ClipboardIo>>,
}

pub struct WaylandBackend {
    compositor: CompositorName,
    proof: ReleaseProof,
    input: Mutex<Input>,
    clipboard: Option<Box<dyn ClipboardIo>>,
}

impl WaylandBackend {
    #[must_use]
    pub fn new(options: Options) -> Self {
        let consent = Consent::new(options.persist_consent, options.consent_file);
        let link = match options.route {
            InputRoute::Socket(path) => Link::Socket(path),
            InputRoute::Portal(portal) => Link::portal(portal, consent),
            InputRoute::Unavailable => Link::Unavailable,
        };
        Self {
            compositor: options.compositor,
            proof: options.ledger.release(options.compositor),
            input: Mutex::new(Input::new(link)),
            clipboard: options.clipboard,
        }
    }

    fn input(&self) -> MutexGuard<'_, Input> {
        self.input.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Connects now (the socket route's handshake, or the portal's first session).
    ///
    /// # Errors
    /// As the first input call would answer.
    pub fn connect_input(&mut self) -> Result<(), Refusal> {
        self.input().session().map(|_| ())
    }

    /// Admits a verb of `kind` under the compositor's release proof, before any libei frame.
    ///
    /// # Errors
    /// `StopPathUnavailable{release_helper_unavailable}`.
    pub fn admit(&self, kind: VerbKind) -> Result<(), Refusal> {
        release::admit(self.proof, kind)
    }

    /// The input connection's state, without connecting.
    #[must_use]
    pub fn input_report(&self) -> InputReport {
        report::report(&self.input())
    }

    /// The engine's EIS descriptor and whether a child could inherit it.
    #[must_use]
    pub fn eis_fd(&self) -> Option<EisFd> {
        self.input()
            .current()
            .map(|session| describe(std::os::fd::AsFd::as_fd(session)))
    }

    pub fn set_clipboard(&mut self, clipboard: Box<dyn ClipboardIo>) {
        self.clipboard = Some(clipboard);
    }

    /// The clipboard rung: data-control, else a granted portal Clipboard, else none.
    #[must_use]
    pub fn clipboard_route(&self) -> ClipboardRoute {
        let granted = match &self.input().link {
            Link::Portal(link) => link
                .started
                .as_ref()
                .is_some_and(|started| started.clipboard),
            Link::Socket(_) | Link::Unavailable => false,
        };
        clipboard::ladder(
            self.clipboard
                .as_ref()
                .is_some_and(|io| io.route() == ClipboardRoute::DataControl),
            granted,
        )
    }

    /// `clipboard{available, reason}`.
    #[must_use]
    pub fn clipboard_capability(&self) -> Availability {
        clipboard::capability(self.clipboard_route())
    }

    fn portal_clipboard<T>(
        &self,
        call: impl FnOnce(
            &mut dyn RemoteDesktop,
            &crate::portal::SessionHandle,
        ) -> Result<T, crate::portal::PortalError>,
    ) -> Result<T, Refusal> {
        let mut input = self.input();
        let Link::Portal(link) = &mut input.link else {
            return Err(clipboard::no_route());
        };
        let Some(session) = link
            .started
            .as_ref()
            .filter(|started| started.clipboard)
            .map(|started| started.session.clone())
        else {
            return Err(clipboard::no_route());
        };
        call(link.portal.as_mut(), &session)
            .map_err(|_| Refusal::new(EngineCode::Internal, Reason::Clipboard))
    }
}

impl Backend for WaylandBackend {
    fn capabilities(&self) -> Capabilities {
        report::capabilities(self.compositor, self.proof, &self.input())
    }

    fn post_input(&mut self, input: &TaggedInput, _route: Route) -> BackendResult<Delivered> {
        release::admit_event(
            self.proof,
            VerbKind::of_event(&input.event),
            Some(&input.event),
        )?;
        send::post(&mut self.input(), &input.event)
    }

    fn pointer(&self) -> Option<Point> {
        self.input().last_point
    }

    fn diagnose(&self) -> Option<omo_computer_core::backend::BackendProbes> {
        let clipboard = self.clipboard_route();
        Some(report::diagnose(self.proof, clipboard, &mut self.input()))
    }

    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        Some(omo_computer_core::report::Platform::Wayland)
    }

    fn clipboard_read(&mut self) -> BackendResult<ClipboardRead> {
        if let Some(io) = self.clipboard.as_mut() {
            return io
                .read()
                .map(|text| ClipboardRead::Text(Some(text)))
                .map_err(|_| Refusal::new(EngineCode::Internal, Reason::Clipboard));
        }
        self.portal_clipboard(|portal, session| portal.clipboard_read(session))
            .map(|text| ClipboardRead::Text(Some(text)))
    }

    fn clipboard_write(&mut self, text: &str) -> BackendResult<()> {
        if let Some(io) = self.clipboard.as_mut() {
            return io
                .write(text)
                .map_err(|_| Refusal::new(EngineCode::Internal, Reason::Clipboard));
        }
        self.portal_clipboard(|portal, session| portal.clipboard_write(session, text))
    }
}
