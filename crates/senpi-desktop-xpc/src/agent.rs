//! Public discovery and a separate non-name-bound anonymous data listener.
use crate::{
    connection::{Accepted, SessionGate},
    dictionary::{Dictionary, VERSION},
    native::{self, Endpoint, Listener, Raw},
    peers::Peers,
    Incoming, TransportError,
};
use parking_lot::Mutex;
use std::{ffi::CString, sync::Arc, time::Instant};

pub struct AgentTransport {
    _named: Option<Listener>,
    _anonymous: Listener,
    peers: Arc<Peers>,
    incoming: flume::Receiver<Incoming>,
}

impl AgentTransport {
    /// Starts no backend and installs no launchd job.
    pub fn start(name: &str) -> Result<Self, TransportError> {
        require_macos_13()?;
        let name = CString::new(name).map_err(|_| TransportError::Dictionary)?;
        let peers = Arc::new(Peers::default());
        let (tx, incoming) = flume::bounded(64);
        let sessions = Arc::clone(&peers);
        let anonymous = Listener::start(None, move |event| accept_session(event, &sessions, &tx, Dictionary::verify))?;
        let endpoint = Arc::new(Endpoint::new(&anonymous)?);
        let discovery = Arc::clone(&peers);
        let named = Listener::start(Some(&name), move |event| {
            accept_discovery(event, &discovery, &endpoint);
        })?;
        Ok(Self {
            _named: Some(named),
            _anonymous: anonymous,
            peers,
            incoming,
        })
    }

    pub async fn next(&self) -> Option<Incoming> {
        self.incoming.recv_async().await.ok()
    }

    #[cfg(test)]
    pub(crate) fn anonymous_for_test(
        verify: fn(&Dictionary) -> Result<crate::VerifiedPeer, crate::RejectReason>,
    ) -> (Self, Endpoint) {
        let peers = Arc::new(Peers::default());
        let (tx, incoming) = flume::bounded(64);
        let sessions = Arc::clone(&peers);
        let anonymous = Listener::test_anonymous(move |event| accept_session(event, &sessions, &tx, verify));
        let endpoint = Endpoint::new(&anonymous).unwrap();
        (Self { _named: None, _anonymous: anonymous, peers, incoming }, endpoint)
    }
}

impl Drop for AgentTransport {
    fn drop(&mut self) {
        self.peers.close();
    }
}

fn accept_discovery(event: Raw, peers: &Arc<Peers>, endpoint: &Arc<Endpoint>) {
    if !native::is_connection(event) {
        return;
    }
    // SAFETY: event is the live connection received by our named listener.
    let Ok((id, peer)) = (unsafe { peers.accept(event) }) else {
        return;
    };
    let weak_peer = Arc::downgrade(&peer);
    let weak_peers = Arc::downgrade(peers);
    let endpoint = Arc::clone(endpoint);
    peer.install(move |event| {
        let (Some(peer), Some(peers)) = (weak_peer.upgrade(), weak_peers.upgrade()) else {
            return;
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // SAFETY: event is borrowed from this connection's current callback.
            let dictionary = unsafe { Dictionary::received(event) }?;
            dictionary.verify().map_err(TransportError::Identity)?;
            let nonce = dictionary.discovery()?;
            let mut reply = dictionary.reply()?;
            reply.put_uint(c"version", VERSION);
            reply.put_data(c"challenge", &nonce);
            reply.put_data(c"epoch", crate::roles::SECURITY_EPOCH.as_bytes());
            reply.put_endpoint(&endpoint);
            peer.send(&reply);
            Ok::<(), TransportError>(())
        }));
        if !matches!(result, Ok(Ok(()))) {
            peers.remove(id);
        }
    });
}

fn capability() -> Result<[u8; 32], TransportError> {
    let mut bytes = [0; 32];
    // SAFETY: getentropy fills a writable 32-byte buffer, below its 256-byte limit.
    if unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), bytes.len()) } != 0 {
        return Err(TransportError::Random);
    }
    Ok(bytes)
}

fn accept_session(
    event: Raw, peers: &Arc<Peers>, incoming: &flume::Sender<Incoming>,
    verify: fn(&Dictionary) -> Result<crate::VerifiedPeer, crate::RejectReason>,
) {
    if !native::is_connection(event) {
        return;
    }
    // SAFETY: event is the live connection of our anonymous listener.
    let Ok((id, peer)) = (unsafe { peers.accept(event) }) else {
        return;
    };
    let cap = match capability() {
        Ok(cap) => cap,
        Err(_) => {
            peers.remove(id);
            return;
        }
    };
    let gate = Arc::new(Mutex::new(SessionGate::new(cap)));
    let (tx, frames) = flume::bounded(64);
    let sender = Mutex::new(Some(tx));
    let stream = Incoming {
        peer: Arc::clone(&peer),
        gate: Arc::clone(&gate),
        frames,
        sequence: Mutex::new(1),
    };
    let weak_peer = Arc::downgrade(&peer);
    let weak_peers = Arc::downgrade(peers);
    peer.install(move |event| {
        let (Some(peer), Some(peers)) = (weak_peer.upgrade(), weak_peers.upgrade()) else {
            return;
        };
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // SAFETY: event is the live callback argument, never a fabricated message.
            let dictionary = unsafe { Dictionary::received(event) }?;
            let accepted = gate.lock().receive(
                verify(&dictionary),
                || dictionary.envelope(),
                Instant::now(),
            )?;
            match accepted {
                Accepted::Frame(frame) => sender
                    .lock()
                    .as_ref()
                    .ok_or(TransportError::Closed)?
                    .try_send(frame)
                    .map_err(|_| TransportError::Capacity)?,
                Accepted::Challenge(nonce) => {
                    let mut reply = dictionary.reply()?;
                    reply.put_uint(c"version", VERSION);
                    reply.put_data(c"challenge", &nonce);
                    reply.put_data(c"epoch", crate::roles::SECURITY_EPOCH.as_bytes());
                    reply.put_uint(c"max_request_bytes", 1024 * 1024);
                    reply.put_uint(c"max_response_bytes", crate::stream::MAX_RESPONSE_BYTES);
                    reply.put_uint(c"max_approval_frames", 64);
                    peer.send(&reply);
                }
                Accepted::Approved(capability) => {
                    let mut reply = dictionary.reply()?;
                    reply.put_uint(c"version", VERSION);
                    reply.put_uint(c"kind", 1);
                    reply.put_data(c"capability", &capability);
                    peer.send(&reply);
                }
            }
            Ok::<(), TransportError>(())
        }));
        if !matches!(result, Ok(Ok(()))) {
            gate.lock().close();
            sender.lock().take();
            peers.remove(id);
        }
    });
    if incoming.try_send(stream).is_err() {
        peers.remove(id);
    }
}

fn require_macos_13() -> Result<(), TransportError> {
    let mut bytes = [0u8; 64];
    let mut size = bytes.len();
    // SAFETY: fixed sysctl name, writable buffer/length, no new value is supplied.
    let status = unsafe {
        libc::sysctlbyname(
            c"kern.osproductversion".as_ptr(),
            bytes.as_mut_ptr().cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if status != 0 || size > bytes.len() {
        return Err(TransportError::UnsupportedOs);
    }
    let text = std::ffi::CStr::from_bytes_until_nul(&bytes)
        .map_err(|_| TransportError::UnsupportedOs)?
        .to_str()
        .map_err(|_| TransportError::UnsupportedOs)?;
    let major = text
        .split('.')
        .next()
        .and_then(|part| part.parse::<u32>().ok());
    if major.is_some_and(|major| major >= 13) {
        Ok(())
    } else {
        Err(TransportError::UnsupportedOs)
    }
}
