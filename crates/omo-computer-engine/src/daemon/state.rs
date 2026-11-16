//! What every connection of one daemon generation shares: the generation capability (authority:
//! the spawning host's and the launcher's connections), the peers registered by `hand.register`
//! with the capability minted for each (one connection each), and the subscribers of the push
//! outbox.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, PoisonError};

use super::admit::{constant_time_eq, Capability, CAPABILITY_LEN};

/// The id of the daemon's own `stopPath.stop` call; its reply is never written to the client.
pub const INJECTED_STOP: &str = "$daemon/stop";

/// The channel a connection's capability came over; it decides the `HostOnly(authority)` methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Grant {
    Authority,
    AttachHost { minted: usize },
}

struct Registered {
    pid: i32,
    process_start: u64,
    capability: Capability,
    bound: bool,
}

pub struct Shared {
    pub runtime: PathBuf,
    pub fake: bool,
    generation: Capability,
    host_pids: Vec<i32>,
    registered: Mutex<Vec<Registered>>,
    subscribers: Mutex<Vec<(usize, UnixStream)>>,
    injectors: Mutex<Vec<(usize, Sender<Vec<u8>>)>>,
    stopped: AtomicBool,
    pub idle: super::idle::Idle,
}

impl Shared {
    #[must_use]
    pub fn new(runtime: PathBuf, fake: bool, generation: Capability, host_pids: Vec<i32>) -> Arc<Self> {
        Arc::new(Self {
            runtime,
            fake,
            generation,
            host_pids,
            registered: Mutex::new(Vec::new()),
            subscribers: Mutex::new(Vec::new()),
            injectors: Mutex::new(Vec::new()),
            stopped: AtomicBool::new(false),
            idle: super::idle::Idle::new(fake && std::env::var_os("OMO_COMPUTER_FAKE_CLOCK").is_some()),
        })
    }

    /// The pid allowlist, keyed on `(pid, processStart)` for registered peers so a recycled pid
    /// never inherits a registration (d-remote.md:207).
    #[must_use]
    pub fn allows_peer(&self, pid: i32, start: Option<u64>) -> bool {
        self.host_pids.contains(&pid)
            || self.registry().iter().any(|peer| peer.pid == pid && Some(peer.process_start) == start)
    }

    fn registry(&self) -> std::sync::MutexGuard<'_, Vec<Registered>> {
        self.registered.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The grant a preamble earns: the generation capability, or a minted one not yet bound to
    /// another connection (it binds now).
    #[must_use]
    pub fn bind(&self, preamble: &Capability) -> Option<Grant> {
        if constant_time_eq(preamble, &self.generation) {
            return Some(Grant::Authority);
        }
        let mut registry = self.registry();
        let (minted, peer) = registry
            .iter_mut()
            .enumerate()
            .find(|(_, peer)| constant_time_eq(preamble, &peer.capability))?;
        if peer.bound {
            return None;
        }
        peer.bound = true;
        Some(Grant::AttachHost { minted })
    }

    /// The capability a request must carry on a connection holding `grant`.
    #[must_use]
    pub fn expected(&self, grant: Grant) -> Capability {
        match grant {
            Grant::Authority => self.generation,
            Grant::AttachHost { minted } => self.registry()[minted].capability,
        }
    }

    /// `hand.register{pid, processStart}`: a fresh capability for that peer's one future connection.
    ///
    /// # Errors
    /// The OS random source could not be read.
    pub fn register(&self, pid: u32, process_start: u64) -> std::io::Result<Capability> {
        let pid = i32::try_from(pid).map_err(std::io::Error::other)?;
        let mut capability: Capability = [0; CAPABILITY_LEN];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut capability)?;
        self.registry().push(Registered { pid, process_start, capability, bound: false });
        Ok(capability)
    }

    pub fn subscribe(&self, connection: usize, stream: UnixStream) {
        self.subscribers.lock().unwrap_or_else(PoisonError::into_inner).push((connection, stream));
    }

    pub fn unsubscribe(&self, connection: usize) {
        self.subscribers.lock().unwrap_or_else(PoisonError::into_inner).retain(|(id, _)| *id != connection);
        self.injectors.lock().unwrap_or_else(PoisonError::into_inner).retain(|(id, _)| *id != connection);
    }

    /// The input of `connection`'s executor, for the daemon's own stop of that session.
    pub fn inject_into(&self, connection: usize, input: Sender<Vec<u8>>) {
        self.injectors.lock().unwrap_or_else(PoisonError::into_inner).push((connection, input));
    }

    /// A stop is hand-wide: the first `stopPath.changed{suspended:true}` from any session stops
    /// every other session once; a resume clears the flag.
    pub fn stop_changed(&self, from: usize, suspended: bool) {
        if !suspended {
            self.stopped.store(false, Ordering::SeqCst);
            return;
        }
        if self.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut line = serde_json::json!({
            "jsonrpc": "2.0", "id": INJECTED_STOP, "method": "stopPath.stop", "params": {"source": "peer"}
        })
        .to_string()
        .into_bytes();
        line.push(b'\n');
        for (id, input) in self.injectors.lock().unwrap_or_else(PoisonError::into_inner).iter() {
            if *id != from {
                let _ = input.send(line.clone());
            }
        }
    }

    /// The push outbox: a notification line reaches every OTHER subscribed connection now (the
    /// writer flushes per line, well inside the 500 ms idle flush).
    pub fn push(&self, from: usize, line: &[u8]) {
        for (id, stream) in self.subscribers.lock().unwrap_or_else(PoisonError::into_inner).iter_mut() {
            if *id != from {
                let _ = stream.write_all(line).and_then(|()| stream.flush());
            }
        }
    }
}
