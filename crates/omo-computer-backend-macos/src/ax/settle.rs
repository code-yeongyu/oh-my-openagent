//! The macOS settle reads: the observer feed attributed to windows, the loading predicate over
//! the window's tree, and the notification surface. No poll and no sleep: every wait is the
//! observer's, bounded by the caller's deadline.

use std::collections::VecDeque;

use omo_computer_core::ax::{Slice, SLICE_MS};
use omo_computer_core::backend::{AxEvent, BackendResult, NotificationFingerprint, SettleSource};
use omo_computer_core::observation::BusyIndicator;

use super::attributes::indicator;
use super::notifications;
use super::reader::{MacAx, CHILD_BATCH};
use super::seam::AxServer;

/// Elements the loading predicate reads at most per window.
pub const BUSY_NODE_BUDGET: usize = 256;

impl<S: AxServer> SettleSource for MacAx<S> {
    fn wait_event(&mut self, until_ms: u64) -> BackendResult<Option<AxEvent>> {
        while let Some(event) = self.server.wait_notification(until_ms) {
            if Some(event.pid) == self.surface.pid {
                let now = self.server.now_ms();
                self.surface.note(&event, now);
                continue;
            }
            return Ok(Some(AxEvent {
                kind: event.notification,
                window: event.window.map(|w| w.to_string()).unwrap_or_default(),
            }));
        }
        Ok(None)
    }

    fn busy(&mut self, window: &str) -> BackendResult<Option<BusyIndicator>> {
        let (_, owner, root) = self.window(window)?;
        self.ensure_observed(owner.pid);
        let mut queue = VecDeque::from([root]);
        let mut read = 0;
        while let Some(element) = queue.pop_front() {
            if read >= BUSY_NODE_BUDGET {
                break;
            }
            read += 1;
            let Slice::Read(Some(attributes)) = self.server.read(element, SLICE_MS) else {
                continue;
            };
            if let Some(found) = indicator(&attributes) {
                return Ok(Some(found));
            }
            if attributes.child_count > 0 {
                if let Slice::Read(children) =
                    self.server.children(element, 0, CHILD_BATCH, SLICE_MS)
                {
                    queue.extend(children);
                }
            }
        }
        Ok(None)
    }

    fn notifications(&mut self) -> BackendResult<Vec<NotificationFingerprint>> {
        notifications::read(self)
    }
}
