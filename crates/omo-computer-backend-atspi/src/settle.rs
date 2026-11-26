//! `SettleSource` for the AT-SPI backend: the observer events on the one connection with a
//! deadline on the bus clock, the A4 loading predicate (`busy` on the window's frame) and the
//! notification banners.

use std::time::Duration;

use omo_computer_core::backend::{AxEvent, BackendResult, NotificationFingerprint, SettleSource};
use omo_computer_core::observation::BusyIndicator;

use crate::backend::AtspiBackend;
use crate::bus::{read_slice, Bus};

const FRAME_SLICE_MS: u64 = 250;

impl<B: Bus> SettleSource for AtspiBackend<B> {
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        let bus = self
            .bus
            .as_mut()
            .ok_or_else(crate::backend::ax_unavailable)?;
        let left = until_ms.saturating_sub(bus.now_ms());
        if left == 0 {
            return Ok(None);
        }
        let event = bus
            .wait_event(Duration::from_millis(left))
            .map_err(|_| crate::backend::ax_unavailable())?;
        Ok(event.map(|event| {
            self.roster.apply(&event);
            AxEvent {
                kind: event.kind,
                window: event.sender.object_id(),
            }
        }))
    }

    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>> {
        let frame = self.frame_for(window).map_err(|refused| refused.refusal)?;
        let bus = self
            .bus
            .as_mut()
            .ok_or_else(crate::backend::ax_unavailable)?;
        let facts = bus
            .read(&frame.node, read_slice(FRAME_SLICE_MS))
            .map_err(|_| crate::backend::ax_unavailable())?;
        Ok(facts.states.busy.then_some(BusyIndicator::AxBusy))
    }

    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        self.banners().map_err(|refused| refused.refusal)
    }
}
