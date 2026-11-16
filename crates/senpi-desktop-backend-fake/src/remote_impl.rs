//! The fake's model of a window that shows a remote screen (Screen Sharing,
//! iPhone Mirroring; plan todo 22): the session-level rules of the macOS
//! port, so the session proves them without a Mac. Such a window takes no AX
//! insertion; its text goes out as the keys of a fixed layout (ASCII, with
//! uppercase and `!@#$%^&*()` behind Shift), every character mapped before
//! anything is typed; and in the background a Screen Sharing window refuses
//! text that needs Shift before the first key.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use serde::Deserialize;

/// How the window's client forwards input, as the macOS classification names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FakeRemoteScreen {
    /// Screen Sharing: key codes, modifiers from the physical keyboard.
    KeyEvents,
    /// iPhone Mirroring: HID reports, modifier keys included.
    HidReports,
}

/// The fixed layout: `None` for a character no key types.
fn stroke(character: char) -> Option<(u8, bool)> {
    match character {
        'a'..='z' | '0'..='9' | ' ' | '\n' | '\r' | '\t' | '-' | '=' | '[' | ']' | ';' | '\'' | ',' | '.' | '/' | '`' | '\\' => Some((character as u8, false)),
        'A'..='Z' | '!' | '@' | '#' | '$' | '%' | '^' | '&' | '*' | '(' | ')' | '_' | '+' | '{' | '}' | ':' | '"' | '<' | '>' | '?' | '~' | '|' => Some((character as u8, true)),
        _ => None,
    }
}

/// Admits `text` for `window`, a remote screen: refuses, with nothing sent,
/// a character the layout cannot type (`InvalidKey`) and, in the background
/// of a Screen Sharing window, text that needs Shift (`BackgroundUnavailable`).
pub(crate) fn admit_remote_text(window: &DesktopWindow, remote: FakeRemoteScreen, text: &str, mode: DeliveryMode) -> CoreResult<()> {
    let mut untypable: Vec<String> = Vec::new();
    let mut shifted: Vec<String> = Vec::new();
    for character in text.chars() {
        match stroke(character) {
            None => {
                let piece = character.to_string();
                if !untypable.contains(&piece) {
                    untypable.push(piece);
                }
            }
            Some((_, true)) => {
                let piece = character.to_string();
                if !shifted.contains(&piece) {
                    shifted.push(piece);
                }
            }
            Some((_, false)) => {}
        }
    }
    if !untypable.is_empty() {
        return Err(DesktopError::invalid_key(format!(
            "window {} ({}) shows a remote screen, which receives key codes and ignores typed text, and no key \
             on the current keyboard layout types {}; nothing was typed",
            window.id,
            window.app,
            untypable.join(" "),
        )));
    }
    if mode == DeliveryMode::Background && remote == FakeRemoteScreen::KeyEvents && !shifted.is_empty() {
        return Err(DesktopError::background_unavailable(format!(
            "window {} ({}) takes Shift, Option, Control and Command from the physical keyboard, so background \
             input cannot hold them to type {}; nothing was sent",
            window.id,
            window.app,
            shifted.join(" "),
        )));
    }
    Ok(())
}
