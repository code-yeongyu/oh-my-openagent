//! The Wayland clipboard ladder (RED skeleton).

use omo_computer_core::backend::Refusal;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipboardRoute {
    DataControl,
    PortalClipboard,
    None,
}

/// A clipboard the backend reads and writes through.
pub trait ClipboardIo: Send {
    fn route(&self) -> ClipboardRoute;
    /// # Errors
    /// The clipboard could not be read.
    fn read(&mut self) -> std::io::Result<String>;
    /// # Errors
    /// The clipboard could not be written.
    fn write(&mut self, text: &str) -> std::io::Result<()>;
}

#[must_use]
pub const fn paste_refusal(_route: ClipboardRoute, _secret: bool) -> Option<Refusal> {
    None
}
