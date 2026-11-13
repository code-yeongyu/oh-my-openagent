//! Server notifications (`audit`, `stopPath.changed`) waiting to be written.
//!
//! A connection drains the outbox right after writing each reply, so a
//! notification caused by a request always follows that request's reply.
//! One queued with no reply to follow (an audit of a request whose waiter
//! already gave up) leaves after the next reply; the host's 500 ms
//! `stopPath.heartbeat` bounds that delay.

use parking_lot::Mutex;
use senpi_desktop_core::methods::Notification;
use senpi_desktop_core::protocol::{JsonRpcVersion, RpcNotification};
use serde::Serialize;

#[derive(Default)]
pub struct Outbox {
    lines: Mutex<Vec<String>>,
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
            Ok(line) => self.lines.lock().push(line),
            Err(error) => eprintln!(
                "senpi-desktop-engine: dropped a {} notification that cannot be encoded: {error}",
                method.name()
            ),
        }
    }

    pub fn drain(&self) -> Vec<String> {
        std::mem::take(&mut *self.lines.lock())
    }
}
