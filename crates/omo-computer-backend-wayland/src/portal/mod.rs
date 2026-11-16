//! The xdg-desktop-portal RemoteDesktop session the libei input rides on (d-linux.md 'Portal
//! RemoteDesktop and libei input'): ONE combined session, `ConnectToEIS` on it, and the
//! portal Clipboard interface probed on the same session.

use std::os::fd::OwnedFd;

pub mod live;

/// The portal's object path of one started session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionHandle(pub String);

/// A started combined session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Started {
    pub session: SessionHandle,
    /// The token the portal returned for a later restore (interface v2), when it returned one.
    pub restore_token: Option<String>,
    /// Whether `RequestClipboard` was granted (Start's `clipboard_enabled`).
    pub clipboard: bool,
}

/// How a portal call failed. Only a user `Cancelled` counts as denied (acceptance 31).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortalError {
    Cancelled,
    Unavailable(String),
    Refused(String),
}

/// The RemoteDesktop portal, live or fake.
pub trait RemoteDesktop: Send {
    /// `CreateSession` -> `SelectDevices(keyboard|pointer)` -> (`RequestClipboard` when
    /// `clipboard`) -> `Start`. Opens the consent dialog unless `restore_token` is honoured;
    /// `persist` asks the portal for a token to keep.
    ///
    /// # Errors
    /// The user cancelled, the portal is missing, or a call failed.
    fn start(&mut self, restore_token: Option<&str>, persist: bool, clipboard: bool) -> Result<Started, PortalError>;

    /// `ConnectToEIS` on a started session.
    ///
    /// # Errors
    /// The portal refused (a second call on one session, on some backends) or failed.
    fn connect_to_eis(&mut self, session: &SessionHandle) -> Result<OwnedFd, PortalError>;

    /// Whether the session's `Closed` signal has arrived.
    fn closed(&mut self, session: &SessionHandle) -> bool;

    /// The portal Clipboard interface's `version`, `None` when the portal has none.
    fn clipboard_version(&mut self) -> Option<u32>;

    /// Writes `text` as the session's selection through the portal Clipboard.
    ///
    /// # Errors
    /// The portal refused or failed.
    fn clipboard_write(&mut self, session: &SessionHandle, text: &str) -> Result<(), PortalError>;

    /// Reads the session's selection through the portal Clipboard.
    ///
    /// # Errors
    /// The portal refused or failed.
    fn clipboard_read(&mut self, session: &SessionHandle) -> Result<String, PortalError>;
}
