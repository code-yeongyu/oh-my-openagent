//! The macOS settle reads (RED stub).

use omo_computer_core::backend::{AxEvent, BackendResult, NotificationFingerprint, SettleSource};
use omo_computer_core::observation::BusyIndicator;

use super::reader::MacAx;
use super::seam::AxServer;

impl<S: AxServer> SettleSource for MacAx<S> {
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        let _ = until_ms;
        Ok(None)
    }

    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>> {
        let _ = window;
        Ok(None)
    }

    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        Ok(Vec::new())
    }
}
