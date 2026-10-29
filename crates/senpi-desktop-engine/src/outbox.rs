//! Audit and stop-path notifications wait for the next reply, as before.
//! Escape instead wakes all connected hosts immediately. Its monotonic counter
//! is retained so a newly attached writer cannot miss an already queued stop.

use parking_lot::Mutex;
use senpi_desktop_core::methods::Notification;
use senpi_desktop_core::protocol::{JsonRpcVersion, RpcNotification};
use serde::Serialize;
use tokio::sync::watch;

pub struct Outbox {
    lines: Mutex<Vec<String>>,
    escape: watch::Sender<Option<String>>,
}

impl Default for Outbox {
    fn default() -> Self {
        let (escape, _) = watch::channel(None);
        Self { lines: Mutex::default(), escape }
    }
}

impl Outbox {
    pub fn push(&self, method: Notification, params: &impl Serialize) {
        let encoded = serde_json::to_value(params).and_then(|params| {
            serde_json::to_string(&RpcNotification {
                jsonrpc: JsonRpcVersion::V2,
                method,
                params,
            })
        });
        match encoded {
            Ok(line) if method == Notification::EscapeStopped => {
                let _ = self.escape.send_replace(Some(line));
            }
            Ok(line) => self.lines.lock().push(line),
            Err(error) => eprintln!(
                "senpi-desktop-engine: dropped a {} notification that cannot be encoded: {error}",
                method.name()
            ),
        }
    }

    pub fn subscribe_escape(&self) -> watch::Receiver<Option<String>> {
        self.escape.subscribe()
    }

    pub fn drain(&self) -> Vec<String> {
        std::mem::take(&mut *self.lines.lock())
    }
}
