//! Background delivery: `PostMessageW` straight into the target window's
//! queue (oh-my-pi `win32/input.rs:184-560`), gated by the toolkit class
//! matrix so a toolkit that ignores posted input yields
//! `BackgroundUnavailable` instead of a silent no-op. The foreground and the
//! cursor are never touched.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use windows_sys::Win32::Foundation::{LPARAM, WPARAM};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_RETURN;
use windows_sys::Win32::UI::WindowsAndMessaging::PostMessageW;

use super::held::HeldButton;
use super::keys::key_message;
use super::messages::{button_messages, WM_CHAR};
use super::native::{self, Window};
use crate::delivery::{
    background_refusal_for, text_input_unsupported, text_units, EventKind, TargetTraits, TextUnit,
};
use crate::integrity::IntegrityRid;

/// The window `id` after the UIPI check and the class matrix for `kind`.
pub(super) fn refusal(id: &str, window: Window, kind: EventKind) -> Option<DesktopError> {
    let class = window.class_name();
    background_refusal_for(
        id,
        TargetTraits {
            class: &class,
            chromium_descendant: window.has_chromium_descendant(),
            foreground: window.owns_foreground(),
            xaml_host: window.is_xaml_host(),
        },
        kind,
    )
}

fn deliverable(id: &str, own: IntegrityRid, kind: EventKind) -> CoreResult<Window> {
    let window = Window::target(id, own)?;
    refusal(id, window, kind).map_or(Ok(window), Err)
}

/// The window a background key chord of `keys` is posted to: the target's
/// keyboard focus, after the matrix accepted the target's own class.
pub(super) fn key_target(id: &str, own: IntegrityRid, keys: &[KeyName]) -> CoreResult<Window> {
    let kind = if keys.len() > 1 || keys.iter().any(|key| key.is_modifier()) {
        EventKind::KeyCombo
    } else {
        EventKind::Keystroke
    };
    deliverable(id, own, kind).map(Window::keyboard_focus)
}

pub(super) fn post(window: Window, message: u32, wparam: WPARAM, lparam: LPARAM) -> CoreResult<()> {
    // SAFETY: [FFI] Win32 copies these scalar message parameters into the
    // target's queue and retains no borrowed memory; a stale HWND fails.
    if unsafe { PostMessageW(window.hwnd(), message, wparam, lparam) } != 0 {
        return Ok(());
    }
    Err(DesktopError::input_failed(format!(
        "PostMessageW failed: {}",
        std::io::Error::last_os_error()
    )))
}

pub(super) fn post_key(window: Window, vk: u16, down: bool, alt_down: bool) -> CoreResult<()> {
    let (message, lparam) = key_message(vk, native::scan_code(vk), down, alt_down);
    post(window, message, usize::from(vk), lparam)
}

pub(super) fn post_button_up(window: Window, held: HeldButton) -> CoreResult<()> {
    post(window, button_messages(held.button).up, 0, held.at)
}

pub(super) fn post_text(id: &str, own: IntegrityRid, text: &str) -> CoreResult<()> {
    let root = Window::target(id, own)?;
    let class = root.class_name();
    if let Some(reason) = text_input_unsupported(&class, cfg!(target_arch = "aarch64")) {
        return Err(DesktopError::input_failed(format!(
            "window {id} ({class}) cannot take typed text: {reason}"
        )));
    }
    refusal(id, root, EventKind::TextInput).map_or(Ok(()), Err)?;
    let window = root.keyboard_focus();
    refusal(id, window, EventKind::TextInput).map_or(Ok(()), Err)?;
    text_units(text).try_for_each(|unit| match unit {
        TextUnit::Enter => {
            post_key(window, VK_RETURN, true, false)?;
            post_key(window, VK_RETURN, false, false)
        }
        TextUnit::Char(character) => {
            let mut units = [0; 2];
            character
                .encode_utf16(&mut units)
                .iter()
                .try_for_each(|unit| post(window, WM_CHAR, usize::from(*unit), 1))
        }
    })
}
