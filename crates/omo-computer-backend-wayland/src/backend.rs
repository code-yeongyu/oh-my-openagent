//! The Wayland backend (RED skeleton: every input refuses).

use std::os::fd::RawFd;
use std::path::PathBuf;

use omo_computer_core::backend::{Backend, BackendResult, Delivered, Refusal, Route, TaggedInput};
use omo_computer_core::capabilities::{Availability, CompositorName};
use omo_computer_core::error::{EngineCode, Reason};

use crate::clipboard::{ClipboardIo, ClipboardRoute};
use crate::ledger::Ledger;
use crate::portal::RemoteDesktop;
use crate::release::VerbKind;

pub const WAYLAND_BACKEND: &str = "wayland";

/// How the engine reaches the compositor's EIS server.
pub enum InputRoute {
    Socket(PathBuf),
    Portal(Box<dyn RemoteDesktop>),
    Unavailable,
}

pub struct Options {
    pub compositor: CompositorName,
    pub route: InputRoute,
    pub ledger: Ledger,
    pub persist_consent: bool,
    pub consent_file: PathBuf,
    pub clipboard: Option<Box<dyn ClipboardIo>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InputReport {
    pub ready: bool,
    pub reconnects: u32,
    pub layouts: Vec<String>,
    pub active_group: Option<String>,
}

pub struct WaylandBackend {
    _options: Options,
}

const UNSUPPORTED: Refusal = Refusal::new(EngineCode::Internal, Reason::InputUnsupported);

impl WaylandBackend {
    #[must_use]
    pub const fn new(options: Options) -> Self {
        Self { _options: options }
    }

    /// # Errors
    /// Always in the skeleton.
    pub const fn connect_input(&mut self) -> Result<(), Refusal> {
        Err(UNSUPPORTED)
    }

    #[must_use]
    pub fn input_report(&self) -> InputReport {
        InputReport::default()
    }

    /// # Errors
    /// Never in the skeleton.
    pub const fn admit(&self, verb: VerbKind) -> Result<(), Refusal> {
        crate::release::admit(verb)
    }

    #[must_use]
    pub const fn eis_fd(&self) -> Option<RawFd> {
        None
    }

    pub fn set_clipboard(&mut self, clipboard: Box<dyn ClipboardIo>) {
        self._options.clipboard = Some(clipboard);
    }

    #[must_use]
    pub const fn clipboard_route(&self) -> ClipboardRoute {
        ClipboardRoute::None
    }

    #[must_use]
    pub const fn clipboard_capability(&self) -> Availability {
        Availability { available: true, reason: None }
    }
}

impl Backend for WaylandBackend {
    fn post_input(&mut self, _input: &TaggedInput, _route: Route) -> BackendResult<Delivered> {
        Err(UNSUPPORTED)
    }
}
