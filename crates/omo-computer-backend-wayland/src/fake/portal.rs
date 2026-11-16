//! A scriptable RemoteDesktop portal that hands out connections to a fake EIS server and
//! counts what the engine asked of it: dialogs, ConnectToEIS calls, presented restore tokens,
//! and the clipboard. Shared by every client it makes, so one fake outlives an engine
//! lifecycle.

use std::os::fd::OwnedFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::portal::{PortalError, RemoteDesktop, SessionHandle, Started};

/// What the fake saw.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PortalLog {
    pub dialogs: u32,
    pub starts: u32,
    pub connects: u32,
    pub restore_tokens_presented: u32,
    pub clipboard_requested_before_start: bool,
    pub clipboard: String,
}

#[derive(Debug, Clone, Default)]
struct Behaviour {
    second_connect: bool,
    tokens: bool,
    inheritable: bool,
    clipboard_version: Option<u32>,
    closed: bool,
    cancel_dialogs: bool,
}

#[derive(Debug, Default)]
struct Shared {
    log: PortalLog,
    behaviour: Behaviour,
    issued: Vec<String>,
    session_connects: u32,
}

/// The fake portal; [`FakePortal::client`] hands out engine-side handles.
#[derive(Debug, Clone)]
pub struct FakePortal {
    socket: PathBuf,
    shared: Arc<Mutex<Shared>>,
}

impl FakePortal {
    #[must_use]
    pub fn new(eis_socket: &Path) -> Self {
        Self {
            socket: eis_socket.to_owned(),
            shared: Arc::default(),
        }
    }

    #[must_use]
    pub fn accepting_second_connect(self, accept: bool) -> Self {
        self.with(|shared| shared.behaviour.second_connect = accept)
    }

    #[must_use]
    pub fn issuing_restore_tokens(self, issue: bool) -> Self {
        self.with(|shared| shared.behaviour.tokens = issue)
    }

    /// Hands EIS fds without close-on-exec, as a careless D-Bus receive would.
    #[must_use]
    pub fn handing_inheritable_fds(self, inheritable: bool) -> Self {
        self.with(|shared| shared.behaviour.inheritable = inheritable)
    }

    #[must_use]
    pub fn with_clipboard(self, version: Option<u32>) -> Self {
        self.with(|shared| shared.behaviour.clipboard_version = version)
    }

    /// Whether the user answers every consent dialog with Cancel (the portal's `Cancelled`).
    pub fn cancel_dialogs(&self, cancel: bool) {
        self.update(|shared| shared.behaviour.cancel_dialogs = cancel);
    }

    /// The portal's `Closed` signal for the live session.
    pub fn close_session(&self) {
        self.update(|shared| shared.behaviour.closed = true);
    }

    #[must_use]
    pub fn log(&self) -> PortalLog {
        self.shared
            .lock()
            .map(|shared| shared.log.clone())
            .unwrap_or_default()
    }

    #[must_use]
    pub fn client(&self) -> FakePortalClient {
        FakePortalClient {
            portal: self.clone(),
        }
    }

    fn with(self, change: impl FnOnce(&mut Shared)) -> Self {
        self.update(change);
        self
    }

    fn update<T>(&self, change: impl FnOnce(&mut Shared) -> T) -> T {
        match self.shared.lock() {
            Ok(mut shared) => change(&mut shared),
            Err(poisoned) => change(&mut poisoned.into_inner()),
        }
    }
}

/// One engine's handle on the fake portal.
#[derive(Debug)]
pub struct FakePortalClient {
    portal: FakePortal,
}

impl RemoteDesktop for FakePortalClient {
    fn start(
        &mut self,
        restore_token: Option<&str>,
        persist: bool,
        clipboard: bool,
    ) -> Result<Started, PortalError> {
        self.portal.update(|shared| {
            shared.log.starts += 1;
            let honoured = restore_token
                .is_some_and(|token| shared.issued.iter().any(|issued| issued == token));
            if restore_token.is_some() {
                shared.log.restore_tokens_presented += 1;
            }
            if !honoured {
                shared.log.dialogs += 1;
                if shared.behaviour.cancel_dialogs {
                    return Err(PortalError::Cancelled);
                }
            }
            let granted = clipboard && shared.behaviour.clipboard_version.is_some();
            shared.log.clipboard_requested_before_start |= granted;
            shared.behaviour.closed = false;
            shared.session_connects = 0;
            let restore_token = (persist && shared.behaviour.tokens)
                .then(|| format!("token-{}", shared.log.starts));
            shared.issued.extend(restore_token.clone());
            Ok(Started {
                session: SessionHandle(format!("/session/{}", shared.log.starts)),
                restore_token,
                clipboard: granted,
            })
        })
    }

    fn connect_to_eis(&mut self, _session: &SessionHandle) -> Result<OwnedFd, PortalError> {
        let (second_refused, inheritable) = self.portal.update(|shared| {
            shared.log.connects += 1;
            shared.session_connects += 1;
            (
                shared.session_connects > 1 && !shared.behaviour.second_connect,
                shared.behaviour.inheritable,
            )
        });
        if second_refused {
            return Err(PortalError::Refused(
                "Session is already connected".to_owned(),
            ));
        }
        let stream = UnixStream::connect(&self.portal.socket)
            .map_err(|error| PortalError::Unavailable(error.to_string()))?;
        let fd = OwnedFd::from(stream);
        if inheritable {
            rustix::io::fcntl_setfd(&fd, rustix::io::FdFlags::empty())
                .map_err(|error| PortalError::Unavailable(error.to_string()))?;
        }
        Ok(fd)
    }

    fn closed(&mut self, _session: &SessionHandle) -> bool {
        self.portal.update(|shared| shared.behaviour.closed)
    }

    fn clipboard_version(&mut self) -> Option<u32> {
        self.portal
            .update(|shared| shared.behaviour.clipboard_version)
    }

    fn clipboard_write(&mut self, _session: &SessionHandle, text: &str) -> Result<(), PortalError> {
        self.portal
            .update(|shared| shared.log.clipboard = text.to_owned());
        Ok(())
    }

    fn clipboard_read(&mut self, _session: &SessionHandle) -> Result<String, PortalError> {
        Ok(self.portal.update(|shared| shared.log.clipboard.clone()))
    }
}
