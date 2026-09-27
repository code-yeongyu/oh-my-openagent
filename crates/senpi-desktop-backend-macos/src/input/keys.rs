//! macOS virtual-key codes, the key-name -> code tables, and the key-event
//! posting used by both the global and the per-process routes.

use std::thread;
use std::time::Duration;

use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
use core_graphics::event_source::CGEventSource;
use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;

use super::cgevent::modifier_flags;
use super::held::{Held, HeldKey, KeyRoute};

/// The key code for a chord key, as the fixed macOS virtual-key table gives it.
pub(crate) fn key_code(key: KeyName) -> CoreResult<u16> {
    let code = match key {
        KeyName::Ctrl => 59,
        KeyName::Alt => 58,
        KeyName::Shift => 56,
        KeyName::Meta => 55,
        KeyName::Enter => 36,
        KeyName::Escape => 53,
        KeyName::Tab => 48,
        KeyName::Space => 49,
        KeyName::Backspace => 51,
        KeyName::Delete => 117,
        KeyName::Insert => 114,
        KeyName::Home => 115,
        KeyName::End => 119,
        KeyName::PageUp => 116,
        KeyName::PageDown => 121,
        KeyName::Up => 126,
        KeyName::Down => 125,
        KeyName::Left => 123,
        KeyName::Right => 124,
        KeyName::CapsLock => 57,
        KeyName::NumLock => 71,
        KeyName::PrintScreen => 105,
        KeyName::F1 => 122,
        KeyName::F2 => 120,
        KeyName::F3 => 99,
        KeyName::F4 => 118,
        KeyName::F5 => 96,
        KeyName::F6 => 97,
        KeyName::F7 => 98,
        KeyName::F8 => 100,
        KeyName::F9 => 101,
        KeyName::F10 => 109,
        KeyName::F11 => 103,
        KeyName::F12 => 111,
        KeyName::F13 => 105,
        KeyName::F14 => 107,
        KeyName::F15 => 113,
        KeyName::F16 => 106,
        KeyName::F17 => 64,
        KeyName::F18 => 79,
        KeyName::F19 => 80,
        KeyName::F20 => 90,
        KeyName::F21 => 110,
        KeyName::F22 => 111,
        KeyName::F23 => 112,
        KeyName::F24 => 113,
        KeyName::Char(character) => char_key_code(character)?,
    };
    Ok(code)
}

fn char_key_code(character: char) -> CoreResult<u16> {
    let code = match character.to_ascii_lowercase() {
        'a' => 0,
        's' => 1,
        'd' => 2,
        'f' => 3,
        'h' => 4,
        'g' => 5,
        'z' => 6,
        'x' => 7,
        'c' => 8,
        'v' => 9,
        'b' => 11,
        'q' => 12,
        'w' => 13,
        'e' => 14,
        'r' => 15,
        'y' => 16,
        't' => 17,
        '1' => 18,
        '2' => 19,
        '3' => 20,
        '4' => 21,
        '6' => 22,
        '5' => 23,
        '=' => 24,
        '9' => 25,
        '7' => 26,
        '-' => 27,
        '8' => 28,
        '0' => 29,
        ']' => 30,
        'o' => 31,
        'u' => 32,
        '[' => 33,
        'i' => 34,
        'p' => 35,
        'l' => 37,
        'j' => 38,
        '\'' => 39,
        'k' => 40,
        ';' => 41,
        '\\' => 42,
        ',' => 43,
        '/' => 44,
        'n' => 45,
        'm' => 46,
        '.' => 47,
        '`' => 50,
        _ => {
            return Err(DesktopError::invalid_key(format!(
                "key '{character}' has no macOS virtual keycode"
            )));
        }
    };
    Ok(code)
}

/// Applies a chord key to the running modifier accumulator.
pub(crate) const fn update_modifier(modifiers: &mut Modifiers, key: KeyName, down: bool) {
    match key {
        KeyName::Ctrl => modifiers.ctrl = down,
        KeyName::Alt => modifiers.alt = down,
        KeyName::Shift => modifiers.shift = down,
        KeyName::Meta => modifiers.meta = down,
        _ => {}
    }
}

/// Builds, routes, and records one key event. Held state is recorded before a
/// down post and cleared after a successful up post, so a failed release stays
/// replayable by `release_all`.
pub(super) fn post_key(
    source: &CGEventSource,
    held: &mut Held,
    code: u16,
    text: Option<&str>,
    down: bool,
    flags: CGEventFlags,
    route: KeyRoute,
) -> CoreResult<()> {
    if down {
        held.key_down(HeldKey {
            route,
            code,
            text: text.map(str::to_string),
        });
    }
    let event = CGEvent::new_keyboard_event(source.clone(), code, down)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz keyboard event"))?;
    match text {
        Some(text) => {
            event.set_string(text);
            event.set_flags(CGEventFlags::CGEventFlagNull);
        }
        None => event.set_flags(flags),
    }
    let posted = match route {
        KeyRoute::Global => {
            event.post(CGEventTapLocation::HID);
            Ok(())
        }
        KeyRoute::Process(pid) => crate::skylight::post_keyboard(pid, &event),
    };
    if posted.is_ok() && !down {
        held.key_up(route, code);
    }
    posted
}

/// Types `text` one character at a time through `route`.
pub(super) fn type_text(
    source: &CGEventSource,
    held: &mut Held,
    text: &str,
    route: KeyRoute,
) -> CoreResult<()> {
    for character in text.chars() {
        let value = character.to_string();
        for down in [true, false] {
            post_key(
                source,
                held,
                0,
                Some(&value),
                down,
                CGEventFlags::CGEventFlagNull,
                route,
            )?;
            thread::sleep(Duration::from_millis(8));
        }
    }
    Ok(())
}

/// Presses `keys` in order and releases them in reverse, keeping the running
/// modifier flags faithful; the first release failure is reported after all
/// releases ran.
pub(super) fn chord(
    source: &CGEventSource,
    held: &mut Held,
    keys: &[KeyName],
    route: KeyRoute,
) -> CoreResult<()> {
    if keys.is_empty() {
        return Err(DesktopError::invalid_key("key chord must not be empty"));
    }
    let mut active = Modifiers::default();
    for &key in keys {
        update_modifier(&mut active, key, true);
        let code = key_code(key)?;
        post_key(source, held, code, None, true, modifier_flags(active), route)?;
        thread::sleep(Duration::from_millis(8));
    }
    let mut first_error = None;
    for &key in keys.iter().rev() {
        update_modifier(&mut active, key, false);
        if let Err(error) = (|| {
            let code = key_code(key)?;
            post_key(source, held, code, None, false, modifier_flags(active), route)
        })() {
            first_error.get_or_insert(error);
        }
        thread::sleep(Duration::from_millis(8));
    }
    first_error.map_or(Ok(()), Err)
}
