//! `--serve <endpoint>`: the stdio protocol on a local socket (a unix socket
//! path, or `\\.\pipe\<name>` on Windows), exit after `--idle-ms` without a
//! client.
//!
//! On unix every same-uid client joins the daemon's one shared session at
//! once (#12229): frames, refs, stop paths and the control slot are shared,
//! session requests are admitted FIFO under the engine's permits, and every
//! notification reaches every live connection. A client whose euid is not the
//! daemon's is closed without a reply. Startup takes the instance lock, binds,
//! and only then writes the resume token; exit removes only the socket and
//! token this daemon created. Windows keeps one client at a time until a
//! client SID check exists.

use std::io;
use std::sync::Arc;
use std::time::Duration;

use crate::engine::Engine;

pub use endpoint::{bind, Bound};

/// # Errors
/// Accepting a client failed.
pub async fn run_serve(engine: Arc<Engine>, bound: Bound, idle: Duration) -> io::Result<()> {
    let served = listen(&engine, bound, idle).await;
    engine.shutdown().await;
    served
}

/// The readiness line a supervisor waits for before connecting.
fn listening(endpoint: &str) {
    eprintln!("senpi-desktop-engine: serving on {endpoint}");
}

fn client_failed(error: &io::Error) {
    eprintln!("senpi-desktop-engine: --serve client connection failed: {error}");
}

#[cfg(unix)]
mod endpoint {
    use std::fs::File;
    use std::io::{self, Write};
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt};
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::path::Path;

    use crate::peer::{identity, EndpointDir};

    /// A bound endpoint: the checked directory, the held instance lock, and the
    /// inodes this daemon created, removed on drop only while they are still its
    /// own. The listener and the token file stay open until then, so neither
    /// inode number can be reused by a successor's file before the check.
    pub struct Bound {
        pub(super) endpoint: String,
        pub(super) listener: Option<UnixListener>,
        dir: EndpointDir,
        socket: (u64, u64),
        token: Option<(File, (u64, u64))>,
        _lock: File,
    }

    /// Checks the endpoint's directory, takes the instance lock, unlinks a
    /// stale socket only after a failed connect, and binds.
    ///
    /// # Errors
    /// The directory rule refuses, another daemon holds the lock or answers at
    /// the endpoint, or the bind failed.
    pub fn bind(endpoint: &str) -> io::Result<Bound> {
        let dir = EndpointDir::open(Path::new(endpoint))?;
        let lock = take_lock(&dir)?;
        let socket = dir.socket();
        remove_stale(&socket)?;
        let listener = UnixListener::bind(&socket)?;
        let socket = identity(&socket)?;
        Ok(Bound {
            endpoint: endpoint.to_owned(),
            listener: Some(listener),
            dir,
            socket,
            token: None,
            _lock: lock,
        })
    }

    fn take_lock(dir: &EndpointDir) -> io::Result<File> {
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(dir.entry(&dir.sibling("lock")))?;
        // SAFETY: `lock` is an open file descriptor for the duration of the call.
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = io::Error::last_os_error();
            return Err(if error.kind() == io::ErrorKind::WouldBlock {
                io::Error::new(io::ErrorKind::AddrInUse, "another daemon holds this endpoint's instance lock")
            } else {
                error
            });
        }
        Ok(lock)
    }

    fn remove_stale(socket: &Path) -> io::Result<()> {
        let meta = match std::fs::symlink_metadata(socket) {
            Ok(meta) => meta,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if !meta.file_type().is_socket() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "the endpoint exists and is not a socket",
            ));
        }
        if UnixStream::connect(socket).is_ok() {
            return Err(io::Error::new(io::ErrorKind::AddrInUse, "a daemon already answers at the endpoint"));
        }
        std::fs::remove_file(socket)
    }

    impl Bound {
        /// Writes the resume token beside the socket: any existing entry is
        /// unlinked, then a new 0600 file is created exclusively, never through a symlink.
        ///
        /// # Errors
        /// The token file cannot be created or written.
        pub fn write_token(&mut self, token: &str) -> io::Result<()> {
            let path = self.dir.entry(&self.dir.sibling("resume"));
            match std::fs::remove_file(&path) {
                Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
                _ => {}
            }
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
                .open(&path)?;
            file.write_all(token.as_bytes())?;
            let meta = file.metadata()?;
            self.token = Some((file, (meta.dev(), meta.ino())));
            Ok(())
        }

        fn remove_own(path: &Path, created: (u64, u64)) {
            if identity(path).is_ok_and(|found| found == created) {
                if let Err(error) = std::fs::remove_file(path) {
                    eprintln!("senpi-desktop-engine: cannot remove {}: {error}", path.display());
                }
            }
        }
    }

    impl Drop for Bound {
        fn drop(&mut self) {
            Self::remove_own(&self.dir.socket(), self.socket);
            if let Some((_, token)) = &self.token {
                Self::remove_own(&self.dir.entry(&self.dir.sibling("resume")), *token);
            }
        }
    }
}

#[cfg(not(unix))]
mod endpoint {
    use std::io;

    pub struct Bound {
        pub(super) endpoint: String,
    }

    /// The pipe is created when serving starts.
    ///
    /// # Errors
    /// Never.
    pub fn bind(endpoint: &str) -> io::Result<Bound> {
        Ok(Bound {
            endpoint: endpoint.to_owned(),
        })
    }

    impl Bound {
        /// # Errors
        /// The token file cannot be written.
        pub fn write_token(&mut self, token: &str) -> io::Result<()> {
            std::fs::write(crate::client::token_file(&self.endpoint), token)
        }
    }
}

#[cfg(unix)]
async fn listen(engine: &Arc<Engine>, bound: Bound, idle: Duration) -> io::Result<()> {
    listen_checked(engine, bound, idle, crate::peer::peer_euid, |refusal| {
        eprintln!("senpi-desktop-engine: audit: closed a --serve client without a reply: {refusal}");
    })
    .await
}

/// Counts live clients; the accept loop waits for the count to reach zero
/// before the idle timer runs again.
#[cfg(unix)]
#[derive(Clone, Default)]
struct Clients(Arc<(std::sync::atomic::AtomicUsize, tokio::sync::Notify)>);

#[cfg(unix)]
impl Clients {
    fn count(&self) -> usize {
        self.0 .0.load(std::sync::atomic::Ordering::SeqCst)
    }

    fn enter(&self) -> ClientGuard {
        self.0 .0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        ClientGuard(self.clone())
    }
}

#[cfg(unix)]
struct ClientGuard(Clients);

#[cfg(unix)]
impl Drop for ClientGuard {
    fn drop(&mut self) {
        if self.0 .0 .0.fetch_sub(1, std::sync::atomic::Ordering::SeqCst) == 1 {
            self.0 .0 .1.notify_one();
        }
    }
}

/// The accept loop with the peer lookup and the refusal audit passed in: the
/// production lookup is the kernel's; only in-crate tests pass another.
#[cfg(unix)]
async fn listen_checked(
    engine: &Arc<Engine>,
    mut bound: Bound,
    idle: Duration,
    lookup: impl Fn(std::os::fd::RawFd) -> io::Result<u32>,
    on_refused: impl Fn(&io::Error),
) -> io::Result<()> {
    use std::os::fd::AsRawFd;

    use crate::connection::{serve_shared_connection, Fanout};

    let Some(listener) = bound.listener.take() else {
        return Err(io::Error::other("the endpoint has no listener"));
    };
    listener.set_nonblocking(true)?;
    let listener = tokio::net::UnixListener::from_std(listener)?;
    listening(&bound.endpoint);
    let me = crate::peer::euid();
    let fanout = Fanout::default();
    let clients = Clients::default();
    let mut tasks = tokio::task::JoinSet::new();
    let served = loop {
        let accepted = if clients.count() == 0 {
            match tokio::time::timeout(idle, listener.accept()).await {
                Ok(accepted) => accepted,
                Err(_) => break Ok(()),
            }
        } else {
            tokio::select! {
                accepted = listener.accept() => accepted,
                () = clients.0 .1.notified() => continue,
            }
        };
        let stream = match accepted {
            Ok((stream, _)) => stream,
            Err(error) => break Err(error),
        };
        if let Err(refusal) = crate::peer::require_peer(stream.as_raw_fd(), me, &lookup) {
            on_refused(&refusal);
            drop(stream);
            continue;
        }
        let guard = clients.enter();
        let (engine, fanout) = (Arc::clone(engine), fanout.clone());
        tasks.spawn(async move {
            let (reader, writer) = stream.into_split();
            if let Err(error) = serve_shared_connection(engine, reader, writer, &fanout).await {
                client_failed(&error);
            }
            drop(guard);
        });
        while tasks.try_join_next().is_some() {}
    };
    while tasks.join_next().await.is_some() {}
    // The bound socket's inode stays referenced until the listener closes.
    drop(bound);
    drop(listener);
    served
}

#[cfg(windows)]
async fn listen(engine: &Arc<Engine>, bound: Bound, idle: Duration) -> io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    use crate::connection::serve_connection;

    let endpoint = bound.endpoint.as_str();
    let mut server = ServerOptions::new().first_pipe_instance(true).create(endpoint)?;
    listening(endpoint);
    while let Ok(connected) = tokio::time::timeout(idle, server.connect()).await {
        connected?;
        let client = std::mem::replace(&mut server, ServerOptions::new().create(endpoint)?);
        let (reader, writer) = tokio::io::split(client);
        let serving = serve_connection(Arc::clone(engine), reader, writer);
        tokio::pin!(serving);
        // One client at a time until a client SID check exists (#12229 B3): a
        // second client is disconnected unanswered, and the pipe name stays ours.
        let served = loop {
            tokio::select! {
                served = &mut serving => break served,
                second = server.connect() => {
                    second?;
                    eprintln!("senpi-desktop-engine: audit: refused a second concurrent --serve pipe client");
                    server.disconnect()?;
                }
            }
        };
        if let Err(error) = served {
            client_failed(&error);
        }
    }
    Ok(())
}

#[cfg(not(any(unix, windows)))]
async fn listen(_engine: &Arc<Engine>, bound: Bound, _idle: Duration) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        format!("--serve {}: local sockets are unsupported on this platform", bound.endpoint),
    ))
}

#[cfg(all(test, unix))]
#[path = "serve/tests.rs"]
mod tests;
