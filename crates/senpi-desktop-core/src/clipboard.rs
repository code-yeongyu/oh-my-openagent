//! The system text clipboard, shared by the native backends.
//!
//! Only UTF-8 text is read and written. A clipboard holding no text reads as
//! the empty string.

use arboard::{Clipboard, Error as ClipboardError};

use crate::error::{CoreResult, DesktopError};

/// The clipboard's current text; empty when it holds no text.
///
/// # Errors
/// `Internal` when the platform clipboard cannot be opened or read.
pub fn read_text() -> CoreResult<String> {
    with_clipboard(|clipboard| match clipboard.get_text() {
        Ok(text) => Ok(text),
        Err(ClipboardError::ContentNotAvailable) => Ok(String::new()),
        Err(error) => Err(DesktopError::internal(format!("reading the clipboard failed: {error}"))),
    })
}

/// Replaces the clipboard's contents with `text`.
///
/// # Errors
/// `Internal` when the platform clipboard cannot be opened or written.
pub fn write_text(text: &str) -> CoreResult<()> {
    with_clipboard(|clipboard| {
        clipboard
            .set_text(text)
            .map_err(|error| DesktopError::internal(format!("writing the clipboard failed: {error}")))
    })
}

fn open() -> CoreResult<Clipboard> {
    Clipboard::new().map_err(|error| DesktopError::internal(format!("opening the clipboard failed: {error}")))
}

/// X11 selections are owner-based: the text a process set is served only while
/// its `Clipboard` lives, so Linux keeps one for the whole process instead of
/// dropping it after each write (oh-my-pi `set_clipboard_text`).
#[cfg(target_os = "linux")]
fn with_clipboard<T>(act: impl FnOnce(&mut Clipboard) -> CoreResult<T>) -> CoreResult<T> {
    use std::sync::{Mutex, PoisonError};

    static CLIPBOARD: Mutex<Option<Clipboard>> = Mutex::new(None);
    let mut slot = CLIPBOARD.lock().unwrap_or_else(PoisonError::into_inner);
    if slot.is_none() {
        *slot = Some(open()?);
    }
    slot.as_mut()
        .map_or_else(|| Err(DesktopError::internal("the clipboard could not be opened")), act)
}

/// macOS and Windows keep clipboard contents after the writer is gone, so a
/// short-lived handle per call is enough.
#[cfg(not(target_os = "linux"))]
fn with_clipboard<T>(act: impl FnOnce(&mut Clipboard) -> CoreResult<T>) -> CoreResult<T> {
    act(&mut open()?)
}

#[cfg(test)]
mod live_tests {
    use super::{read_text, write_text};

    /// Touches the real system clipboard, so it runs only where the CI
    /// workflow asks for it on a disposable runner; it restores what was there.
    #[test]
    #[ignore = "live: writes the real system clipboard (hosted CI runners only)"]
    fn a_written_text_reads_back_from_the_system_clipboard() {
        let previous = read_text().expect("the clipboard reads");
        let probe = "senpi-clipboard-roundtrip-\u{1F4CB}";
        write_text(probe).expect("the clipboard writes");
        let read = read_text();
        write_text(&previous).expect("the previous text is restored");
        println!("clipboard_roundtrip={:?}", read.as_deref() == Ok(probe));
        assert_eq!(read.as_deref(), Ok(probe));
    }
}
