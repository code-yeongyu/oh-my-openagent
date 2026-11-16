//! The fakes the crate's tests and the Linux QA driver run against: an EIS server on a real
//! socket, a RemoteDesktop portal and a clipboard. Never part of a shipped engine.

mod eis;
mod eis_client;
mod portal;

pub use eis::{FakeEis, FakeRegion, Log, Mode, Script};
pub use portal::{FakePortal, FakePortalClient, PortalLog};

use crate::clipboard::{ClipboardIo, ClipboardRoute};

/// An in-memory data-control clipboard.
#[derive(Debug, Default)]
pub struct FakeClipboard {
    text: String,
}

impl ClipboardIo for FakeClipboard {
    fn route(&self) -> ClipboardRoute {
        ClipboardRoute::DataControl
    }

    fn read(&mut self) -> std::io::Result<String> {
        Ok(self.text.clone())
    }

    fn write(&mut self, text: &str) -> std::io::Result<()> {
        text.clone_into(&mut self.text);
        Ok(())
    }
}
