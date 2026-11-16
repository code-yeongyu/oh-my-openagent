//! The AT-SPI backend: one bus connection per engine, the application roster and focus kept
//! from events, observes through the core walk, refs re-identified from the cached snapshot,
//! the action-resolution ladder, and the session-level reads (flag, busy, banners, apps).

mod actions;
mod observe;
mod reader;
mod refs;
mod session;
mod state;

use omo_computer_core::backend::{
    refusing_capabilities, AxBackend, AxSnapshot, Backend, BackendResult, Delivered,
    PermissionProbe, Ref, Refusal, Resolved, Semantic, SnapshotRequest,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::results::PermissionState;

use crate::bus::{Bus, CALL_BUDGET};
use crate::caps::{AxCapability, AxPermission};
use crate::owner::WindowSource;
use crate::types::AxRefusal;

pub(crate) use actions::press;
pub use observe::Observation;

use refs::RefTable;
use state::Roster;

/// The events registered at connect (`d-linux.md` '### Tree', ADO-18).
pub const EVENTS: &[&str] = &[
    "window:activate",
    "window:deactivate",
    "window:create",
    "window:destroy",
    "object:state-changed:focused",
    "object:children-changed",
    "object:property-change:accessible-name",
];

/// Whether the accessibility bus answered at connect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reach {
    NoBus,
    Live,
}

pub struct AtspiBackend<B: Bus> {
    pub(crate) bus: Option<B>,
    windows: Box<dyn WindowSource>,
    reach: Reach,
    pub(crate) roster: Roster,
    refs: RefTable,
}

impl<B: Bus> AtspiBackend<B> {
    /// Connects the backend to `bus` (none: no session bus): registers the events once and
    /// reads the registry once; every later roster change arrives as an event.
    #[must_use]
    pub fn new(bus: Option<B>, windows: Box<dyn WindowSource>) -> Self {
        let mut roster = Roster::default();
        let mut reach = Reach::NoBus;
        let bus = bus.and_then(|mut bus| {
            let connected = bus
                .register_events(EVENTS)
                .and_then(|()| bus.applications(CALL_BUDGET));
            connected.ok().map(|apps| {
                roster.apps = apps;
                reach = Reach::Live;
                bus
            })
        });
        Self {
            bus,
            windows,
            reach,
            roster,
            refs: RefTable::default(),
        }
    }

    /// `ax:{available, reason?}` as the capability vector reports it.
    #[must_use]
    pub fn ax_capability(&self) -> AxCapability {
        match self.reach {
            Reach::Live => AxCapability {
                available: true,
                reason: None,
            },
            Reach::NoBus => AxCapability {
                available: false,
                reason: Some("no_bus"),
            },
        }
    }

    /// `ax_permission`: a real read, never asserted.
    #[must_use]
    pub fn ax_permission(&self) -> AxPermission {
        match self.reach {
            Reach::NoBus => AxPermission::BusUnreachable,
            Reach::Live if self.roster.apps.is_empty() => AxPermission::ToolkitsSilent,
            Reach::Live => AxPermission::Granted,
        }
    }

    pub(crate) fn live(&mut self) -> Result<&mut B, AxRefusal> {
        self.bus.as_mut().ok_or_else(AxRefusal::no_bus)
    }
}

impl<B: Bus> Backend for AtspiBackend<B> {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            observe: self.reach == Reach::Live,
            ..refusing_capabilities()
        }
    }

    fn probe_permissions(&self) -> PermissionProbe {
        let accessibility = match self.ax_permission() {
            AxPermission::Granted => PermissionState::Granted,
            AxPermission::ToolkitsSilent => PermissionState::Denied,
            AxPermission::BusUnreachable => PermissionState::Unknown,
        };
        PermissionProbe {
            capture: PermissionState::Unknown,
            input: PermissionState::Unknown,
            accessibility,
        }
    }

    fn ax_reader(&mut self) -> Option<&mut dyn omo_computer_core::ax::AxReader> {
        Some(self)
    }
}

impl<B: Bus> AxBackend for AtspiBackend<B> {
    fn snapshot(&mut self, request: &SnapshotRequest) -> BackendResult<AxSnapshot> {
        self.observe(request)
            .map(|observed| observed.snapshot)
            .map_err(|refused| refused.refusal)
    }

    fn resolve(&mut self, reference: &Ref) -> BackendResult<Resolved> {
        self.resolve_detailed(reference)
            .map_err(|refused| refused.refusal)
    }

    fn perform(&mut self, reference: &Ref, action: &Semantic) -> BackendResult<Delivered> {
        self.perform_detailed(reference, action)
            .map_err(|refused| refused.refusal)
    }
}

/// The refusal a backend without a bus answers every accessibility read with.
pub(crate) const fn ax_unavailable() -> Refusal {
    Refusal::bare(omo_computer_core::error::EngineCode::AxUnsupported)
}
