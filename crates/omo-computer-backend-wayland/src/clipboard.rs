//! The Wayland clipboard ladder (d-linux.md compositor matrix, clipboard column): data-control
//! where the compositor advertises it, else the portal `Clipboard` interface on the combined
//! RemoteDesktop session (probed: its `version` read, `RequestClipboard` before `Start`, the
//! grant read from `Start`), else no route - and with no route a paste is never turned into
//! keystrokes.

use omo_computer_core::backend::Refusal;
use omo_computer_core::capabilities::Availability;
use omo_computer_core::error::{EngineCode, Reason};

/// The rung the clipboard rides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipboardRoute {
    DataControl,
    PortalClipboard,
    None,
}

/// A clipboard the backend reads and writes through (the data-control rung, or a fake).
pub trait ClipboardIo: Send {
    fn route(&self) -> ClipboardRoute;

    /// # Errors
    /// The clipboard could not be read.
    fn read(&mut self) -> std::io::Result<String>;

    /// # Errors
    /// The clipboard could not be written.
    fn write(&mut self, text: &str) -> std::io::Result<()>;
}

/// The rung a hand rides: a data-control clipboard first, then a granted portal Clipboard.
#[must_use]
pub const fn ladder(data_control: bool, portal_granted: bool) -> ClipboardRoute {
    if data_control {
        ClipboardRoute::DataControl
    } else if portal_granted {
        ClipboardRoute::PortalClipboard
    } else {
        ClipboardRoute::None
    }
}

/// `clipboard{available, reason}`.
#[must_use]
pub fn capability(route: ClipboardRoute) -> Availability {
    match route {
        ClipboardRoute::DataControl | ClipboardRoute::PortalClipboard => Availability {
            available: true,
            reason: None,
        },
        ClipboardRoute::None => Availability {
            available: false,
            reason: Some(Reason::NoClipboardRoute.wire().to_owned()),
        },
    }
}

/// The refusal a write meets when there is no route: `Unavailable{no_clipboard_route}` naming
/// `type` as the next call - the caller decides, the backend never types instead.
#[must_use]
pub fn no_route() -> Refusal {
    Refusal::new(EngineCode::Internal, Reason::NoClipboardRoute)
        .with_data(serde_json::json!({ "nextCall": "type" }))
}

/// What a paste of `secret` or ordinary text meets on `route`: nothing on a route, otherwise
/// the typed refusal (a secret is refused with nothing typed and no next call).
#[must_use]
pub fn paste_refusal(route: ClipboardRoute, secret: bool) -> Option<Refusal> {
    match (route, secret) {
        (ClipboardRoute::DataControl | ClipboardRoute::PortalClipboard, _) => None,
        (ClipboardRoute::None, true) => Some(Refusal::new(
            EngineCode::Internal,
            Reason::SecretNoClipboardRoute,
        )),
        (ClipboardRoute::None, false) => Some(no_route()),
    }
}
