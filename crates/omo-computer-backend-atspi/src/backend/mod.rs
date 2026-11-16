//! The AT-SPI backend (RED stage: stubs that compile and answer the wrong thing).

use omo_computer_core::backend::{
    AxBackend, AxSnapshot, Backend, BackendResult, Delivered, Ref, Refusal, Semantic,
    SnapshotRequest,
};
use omo_computer_core::error::EngineCode;
use omo_computer_core::listing::AppInfo;
use omo_computer_core::observation::BusyIndicator;

use crate::apps::launch::Launcher;
use crate::bus::{Bus, NodeId};
use crate::caps::{AxCapability, AxPermission};
use crate::owner::WindowSource;
use crate::types::{AxRefusal, Fingerprint, SessionOpen};

/// One observe: the snapshot, or none when the focused element is secure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Observation {
    pub snapshot: AxSnapshot,
    pub secure: bool,
}

pub struct AtspiBackend<B: Bus> {
    bus: Option<B>,
    windows: Box<dyn WindowSource>,
}

const UNSUPPORTED: Refusal = Refusal::new(EngineCode::AxUnsupported, "snapshot_unsupported");

impl<B: Bus> AtspiBackend<B> {
    #[must_use]
    pub fn new(bus: Option<B>, windows: Box<dyn WindowSource>) -> Self {
        Self { bus, windows }
    }

    #[must_use]
    pub fn ax_capability(&self) -> AxCapability {
        let _ = (&self.bus, &self.windows);
        AxCapability { available: true, reason: None }
    }

    #[must_use]
    pub fn ax_permission(&self) -> AxPermission {
        AxPermission::Granted
    }

    pub fn open_session(&mut self) -> SessionOpen {
        SessionOpen::default()
    }

    /// # Errors
    /// Never in the RED stage.
    pub fn focused(&mut self) -> BackendResult<Option<NodeId>> {
        Ok(None)
    }

    /// # Errors
    /// Always in the RED stage.
    pub fn observe(&mut self, request: &SnapshotRequest) -> Result<Observation, AxRefusal> {
        let _ = request;
        Err(AxRefusal::plain(UNSUPPORTED))
    }

    /// # Errors
    /// Always in the RED stage.
    pub fn perform_detailed(&mut self, reference: &Ref, action: &Semantic) -> Result<Delivered, AxRefusal> {
        let _ = (reference, action);
        Err(AxRefusal::plain(UNSUPPORTED))
    }

    pub fn busy(&mut self, window: &str) -> Option<BusyIndicator> {
        let _ = window;
        None
    }

    /// # Errors
    /// Never in the RED stage.
    pub fn notifications(&mut self) -> Result<Vec<Fingerprint>, AxRefusal> {
        Ok(Vec::new())
    }

    pub fn apps_list(&mut self) -> Vec<AppInfo> {
        Vec::new()
    }

    /// # Errors
    /// Never in the RED stage.
    pub fn apps_open(&mut self, app_key: &str, launcher: &mut dyn Launcher) -> Result<u32, AxRefusal> {
        let _ = (app_key, launcher);
        Ok(0)
    }
}

impl<B: Bus> Backend for AtspiBackend<B> {}

impl<B: Bus> AxBackend for AtspiBackend<B> {}
