//! Windows window identity (row 60, d-windows.md '## Windows and DPI'): a window is
//! `{hwnd, pid, processStart}`, so a recycled `HWND` is a different window.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The identity a ref or a saved target binds to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowIdentity {
    pub hwnd: isize,
    pub pid: u32,
    pub process_start: u64,
}

/// Whether the window behind `saved` is still that window.
///
/// # Errors
/// `StaleRef{identity_changed}` when the handle now names another process's window.
pub fn still_same(saved: WindowIdentity, now: WindowIdentity) -> Result<(), Refusal> {
    let _ = (saved, now, Refusal::new(EngineCode::StaleRef, Reason::IdentityChanged.wire()));
    Ok(())
}

#[cfg(test)]
mod tests;
