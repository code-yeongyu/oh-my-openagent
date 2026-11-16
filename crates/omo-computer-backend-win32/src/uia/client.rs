//! One client per session (d-windows.md '## UI Automation', One client, one thread): the
//! `CUIAutomation8` client is created at the session's first UIA read and kept for the session,
//! never per call; the secure-focus read and the value read-back go through the same client.

use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::EngineCode;

use super::element::UiaError;
use super::reader::UiaReader;
use super::reidentify::reidentify;
use super::source::UiaSource;

/// Creates the session's client (`CoCreateInstance(CLSID_CUIAutomation8)` on the `uia` thread).
pub type Factory<S> = Box<dyn FnMut() -> Result<S, UiaError> + Send>;

/// The session's UI Automation client, created once.
pub struct UiaHost<S> {
    factory: Factory<S>,
    reader: Option<UiaReader<S>>,
    created: u32,
}

impl<S: UiaSource> UiaHost<S> {
    #[must_use]
    pub fn new(factory: Factory<S>) -> Self {
        Self {
            factory,
            reader: None,
            created: 0,
        }
    }

    /// The session's reader, starting its client on first use.
    ///
    /// # Errors
    /// `AxUnsupported` when the client cannot be created.
    pub fn reader(&mut self) -> BackendResult<&mut UiaReader<S>> {
        if self.reader.is_none() {
            let source = (self.factory)().map_err(|_| Refusal::bare(EngineCode::AxUnsupported))?;
            self.created = self.created.saturating_add(1);
            self.reader = Some(UiaReader::new(source));
        }
        self.reader
            .as_mut()
            .ok_or_else(|| Refusal::bare(EngineCode::AxUnsupported))
    }

    /// How many clients this host created.
    #[must_use]
    pub const fn clients_created(&self) -> u32 {
        self.created
    }

    /// The session ended: its client goes with it.
    pub fn end_session(&mut self) {
        self.reader = None;
    }

    /// Whether a password field has focus, in `window` (a decimal `HWND`) or anywhere;
    /// `None` when the focus cannot be read.
    pub fn secure_focus(&mut self, window: Option<&str>) -> Option<bool> {
        let focused = self.reader().ok()?.source().focused()?;
        match window {
            Some(window) if window.parse::<isize>().ok()? != focused.hwnd => Some(false),
            _ => Some(focused.is_password),
        }
    }

    /// The value the element with `runtime_id` reads back after a write; never a password's.
    pub fn value_readback(&mut self, runtime_id: &[i32]) -> Option<String> {
        let reader = self.reader().ok()?;
        let element = reidentify(reader.source_mut().find_runtime_id(0, runtime_id)).ok()?;
        if element.is_password {
            None
        } else {
            element.value
        }
    }
}
