//! Portable Win32 menu policy; native adapters supply only live observations
//! and command dispatch. Matching and refusal policy belong to desktop core.

pub(crate) mod native;
pub(crate) mod pattern_guard;

use senpi_desktop_core::error::{CoreResult, DesktopError};

pub(crate) const MAX_ITEMS: usize = 512;
#[cfg(target_os = "windows")]
pub(crate) const MAX_LABEL_UNITS: usize = 4096;
#[cfg(target_os = "windows")]
pub(crate) const MAX_UIA_NODES: usize = 8192;
#[cfg(target_os = "windows")]
pub(crate) const MAX_UIA_DEPTH: usize = 8;
pub(crate) const NOTIFY_BY_POSITION: u32 = 0x0800_0000;

pub(crate) fn failed(message: impl Into<String>) -> DesktopError {
    DesktopError::ax_failed(message)
}

/// UIA names are already decoded and must not use this native-label parser.
pub(crate) fn native_label(label: &str) -> (String, Option<String>) {
    let (label, shortcut) = label.split_once('\t').map_or((label, None), |(label, shortcut)| {
        (label, (!shortcut.trim().is_empty()).then(|| shortcut.trim().to_owned()))
    });
    let mut title = String::with_capacity(label.len());
    let mut chars = label.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '&' || chars.peek().is_none() {
            title.push(ch);
        } else if chars.peek() == Some(&'&') {
            chars.next();
            title.push('&');
        }
    }
    (title, shortcut)
}

/// `WM_COMMAND` uses LOWORD(wParam), whereas `WM_MENUCOMMAND` takes a position.
pub(crate) fn native_message(id: u32, position: u32, style: u32) -> CoreResult<(u32, usize)> {
    if style & NOTIFY_BY_POSITION != 0 {
        Ok((0x0126, position as usize))
    } else if u16::try_from(id).is_ok() {
        Ok((0x0111, id as usize))
    } else {
        Err(failed("menu command ID cannot be represented by WM_COMMAND; no command was dispatched"))
    }
}

#[cfg(test)]
mod native_tests;
#[cfg(test)]
mod tests;
