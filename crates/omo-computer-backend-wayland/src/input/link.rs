//! How the engine reaches the compositor's EIS server, and the bounded reconnect per route
//! (d-linux.md 'Connection lifecycle'). On `LIBEI_SOCKET` a reconnect is a plain new client
//! connection. On the portal route the fd is the one `ConnectToEIS` of the one combined
//! session: the engine re-calls `ConnectToEIS` on the LIVE session while `Closed` has not
//! arrived; otherwise the session is lost, and a new one is opened only under a persisted
//! restore token - never a consent dialog inside an input call. A user who cancels the
//! consent dialog has denied input for this engine lifecycle: every later input call answers
//! `PermissionDenied{permission:"portal"}` without asking the portal again (acceptance 31).

use std::os::fd::{AsFd, OwnedFd};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

use super::client::{EiSession, LinkError};
use super::fd::set_cloexec;
use crate::consent::Consent;
use crate::portal::{PortalError, RemoteDesktop, Started};

/// The reconnect backoff steps, in milliseconds: 3 attempts, doubling from 250 ms.
pub const RECONNECT_BACKOFF_MS: [u64; 3] = [250, 500, 1_000];

/// The portal route's state: the portal, the started session, and the consent policy.
pub struct PortalLink {
    pub(crate) portal: Box<dyn RemoteDesktop>,
    pub(crate) started: Option<Started>,
    consent: Consent,
    /// The user cancelled the consent dialog in this engine lifecycle.
    denied: bool,
}

/// The route the hand's input takes.
pub enum Link {
    Socket(PathBuf),
    Portal(PortalLink),
    /// No RemoteDesktop portal and no `LIBEI_SOCKET`: the second input route (row 53) is not
    /// proven, so input is advertised unavailable.
    Unavailable,
}

/// The answer once every bounded attempt failed or the portal session is gone.
pub fn libei_lost() -> Refusal {
    Refusal::new(EngineCode::Internal, Reason::LibeiLost)
        .with_data(serde_json::json!({ "nextCall": "capabilities()" }))
}

fn unavailable() -> Refusal {
    Refusal::new(EngineCode::Internal, Reason::InputUnsupported)
}

/// The user's Cancel of the consent dialog: the only portal answer that counts as denied.
fn consent_denied() -> Refusal {
    Refusal::bare(EngineCode::PermissionDenied)
        .with_data(serde_json::json!({ "permission": "portal" }))
}

impl Link {
    #[must_use]
    pub fn portal(portal: Box<dyn RemoteDesktop>, consent: Consent) -> Self {
        Self::Portal(PortalLink {
            portal,
            started: None,
            consent,
            denied: false,
        })
    }

    /// The first connection of this engine lifecycle. On the portal route this is the one
    /// moment the consent dialog may open (the first input call).
    ///
    /// # Errors
    /// `PermissionDenied{permission:"portal"}` once the user cancelled the dialog, else
    /// `Internal{input_unsupported}`; nothing sent either way.
    pub fn connect(&mut self) -> Result<EiSession, Refusal> {
        let stream = match self {
            Self::Socket(path) => UnixStream::connect(&*path).map_err(|_| unavailable())?,
            Self::Portal(link) => {
                if link.denied {
                    return Err(consent_denied());
                }
                if link.started.is_none() {
                    let clipboard = link.portal.clipboard_version().is_some();
                    let token = link.consent.token();
                    let persist = link.consent.persist();
                    let started = match link.portal.start(token.as_deref(), persist, clipboard) {
                        Ok(started) => started,
                        Err(PortalError::Cancelled) => {
                            link.denied = true;
                            return Err(consent_denied());
                        }
                        Err(PortalError::Unavailable(_) | PortalError::Refused(_)) => {
                            return Err(unavailable())
                        }
                    };
                    link.consent.keep(started.restore_token.as_deref());
                    link.started = Some(started);
                }
                let session = link
                    .started
                    .as_ref()
                    .map(|started| started.session.clone())
                    .ok_or_else(unavailable)?;
                stream_from(
                    link.portal
                        .connect_to_eis(&session)
                        .map_err(|_| unavailable())?,
                )?
            }
            Self::Unavailable => return Err(unavailable()),
        };
        EiSession::connect(stream).map_err(|_| unavailable())
    }

    /// The bounded reconnect after a transient failure: up to three attempts with backoff.
    ///
    /// # Errors
    /// `Internal{libei_lost}` with `nextCall:"capabilities()"`, or the consent denial; nothing
    /// sent either way.
    pub fn reconnect(&mut self, sleep: &dyn Fn(Duration)) -> Result<EiSession, Refusal> {
        for delay in RECONNECT_BACKOFF_MS {
            sleep(Duration::from_millis(delay));
            match self.attempt() {
                Ok(session) => return Ok(session),
                Err(Attempt::Retry) => {}
                Err(Attempt::SessionLost) => return Err(libei_lost()),
                Err(Attempt::Denied) => return Err(consent_denied()),
            }
        }
        Err(libei_lost())
    }

    fn attempt(&mut self) -> Result<EiSession, Attempt> {
        let stream = match self {
            Self::Socket(path) => UnixStream::connect(&*path).map_err(|_| Attempt::Retry)?,
            Self::Portal(link) => link.reconnect_stream()?,
            Self::Unavailable => return Err(Attempt::SessionLost),
        };
        EiSession::connect(stream).map_err(|error| match error {
            LinkError::Lost | LinkError::Interrupted | LinkError::Handshake(_) => Attempt::Retry,
        })
    }
}

enum Attempt {
    Retry,
    SessionLost,
    /// The user cancelled the consent dialog (now or earlier in this lifecycle).
    Denied,
}

impl PortalLink {
    fn reconnect_stream(&mut self) -> Result<UnixStream, Attempt> {
        if self.denied {
            return Err(Attempt::Denied);
        }
        let live = self
            .started
            .as_ref()
            .map(|started| started.session.clone())
            .filter(|session| !self.portal.closed(session));
        if let Some(session) = live {
            match self.portal.connect_to_eis(&session) {
                Ok(fd) => return stream_from(fd).map_err(|_| Attempt::Retry),
                Err(PortalError::Refused(_)) => {}
                Err(PortalError::Cancelled | PortalError::Unavailable(_)) => {
                    return Err(Attempt::Retry)
                }
            }
        }
        // The session is lost. Only a persisted token may open a new one without a dialog.
        self.started = None;
        let token = self.consent.token().ok_or(Attempt::SessionLost)?;
        let clipboard = self.portal.clipboard_version().is_some();
        let started = match self.portal.start(Some(&token), true, clipboard) {
            Ok(started) => started,
            Err(PortalError::Cancelled) => {
                self.denied = true;
                return Err(Attempt::Denied);
            }
            Err(PortalError::Unavailable(_) | PortalError::Refused(_)) => {
                return Err(Attempt::SessionLost)
            }
        };
        self.consent.keep(started.restore_token.as_deref());
        let session = started.session.clone();
        self.started = Some(started);
        let fd = self
            .portal
            .connect_to_eis(&session)
            .map_err(|_| Attempt::Retry)?;
        stream_from(fd).map_err(|_| Attempt::Retry)
    }
}

/// The portal's fd as a close-on-exec stream: a D-Bus receive may hand it over inheritable.
fn stream_from(fd: OwnedFd) -> Result<UnixStream, Refusal> {
    set_cloexec(fd.as_fd()).map_err(|_| unavailable())?;
    Ok(UnixStream::from(fd))
}
