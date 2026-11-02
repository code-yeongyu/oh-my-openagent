use crate::{
    native::{Peer, Raw},
    TransportError,
};
use parking_lot::Mutex;
use std::{collections::HashMap, sync::Arc};

#[derive(Default)]
pub(crate) struct Peers {
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    next: u64,
    peers: HashMap<u64, Arc<Peer>>,
}

impl Peers {
    /// raw is the current listener callback's connection argument.
    pub(crate) unsafe fn accept(&self, raw: Raw) -> Result<(u64, Arc<Peer>), TransportError> {
        // SAFETY: caller supplies a live listener connection event.
        let peer = Arc::new(unsafe { Peer::accept(raw) }?);
        if !peer.same_user() {
            peer.cancel();
            return Err(TransportError::User);
        }
        self.insert(peer)
    }

    fn insert(&self, peer: Arc<Peer>) -> Result<(u64, Arc<Peer>), TransportError> {
        let mut state = self.state.lock();
        if state.peers.len() >= 128 {
            peer.cancel();
            return Err(TransportError::Capacity);
        }
        state.next = state.next.checked_add(1).ok_or(TransportError::Capacity)?;
        let id = state.next;
        state.peers.insert(id, Arc::clone(&peer));
        Ok((id, peer))
    }

    pub(crate) fn remove(&self, id: u64) {
        if let Some(peer) = self.state.lock().peers.remove(&id) {
            peer.cancel();
        }
    }

    pub(crate) fn close(&self) {
        for peer in self.state.lock().peers.drain().map(|(_, peer)| peer) {
            peer.cancel();
        }
    }
}

#[cfg(test)]
mod tests;
