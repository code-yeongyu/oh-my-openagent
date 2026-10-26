use crate::{
    connection::SessionGate,
    dictionary::{Dictionary, VERSION},
    native::Peer,
    TransportError,
};
use parking_lot::Mutex;
use std::sync::Arc;
mod forward;
pub use forward::forward_frames;

/// Sixteen current inline capture budgets plus JSON/AX headroom, rounded up.
/// The current 5 MB PNG default expands to about 6.7 MB of base64.
pub(crate) const MAX_RESPONSE_BYTES: u64 =
    (senpi_desktop_core::types::DEFAULT_CAPTURE_MAX_BYTES.div_ceil(3) * 4 * 16 + 1024 * 1024)
        .next_power_of_two();

/// Created only by the authenticated anonymous listener. No reconnect or replay.
pub struct Incoming {
    pub(crate) peer: Arc<Peer>,
    pub(crate) gate: Arc<Mutex<SessionGate>>,
    pub(crate) frames: flume::Receiver<Vec<u8>>,
    pub(crate) sequence: Mutex<u64>,
}

impl Incoming {
    /// Exactly one already authenticated and approved NDJSON frame.
    pub async fn receive(&self) -> Option<Vec<u8>> {
        let frame = self.frames.recv_async().await.ok()?;
        if self.gate.lock().is_closed() {
            None
        } else {
            Some(frame)
        }
    }

    /// Sends a JSON-RPC reply or notification only to this original connection.
    pub fn send(&self, payload: &[u8]) -> Result<(), TransportError> {
        if u64::try_from(payload.len()).map_err(|_| TransportError::Dictionary)?
            > MAX_RESPONSE_BYTES
        {
            return Err(TransportError::Dictionary);
        }
        let gate = self.gate.lock();
        let capability = gate.reply_capability()?;
        let mut sequence = self.sequence.lock();
        let next = sequence.checked_add(1).ok_or(TransportError::Sequence)?;
        let mut reply = Dictionary::new()?;
        reply.put_uint(c"version", VERSION);
        reply.put_uint(c"kind", 2);
        reply.put_uint(c"sequence", *sequence);
        reply.put_data(c"capability", &capability);
        reply.put_data(c"payload", payload);
        self.peer.send(&reply);
        *sequence = next;
        Ok(())
    }

    pub fn close(&self) {
        self.gate.lock().close();
        self.peer.cancel();
    }
}

impl Drop for Incoming {
    fn drop(&mut self) {
        self.close();
    }
}
