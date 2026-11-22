//! macOS virtual-key codes, the key-name -> code tables, and the key-event
//! posting used by both the global and the per-process routes.

use std::thread;
use std::time::Duration;

use core_graphics::event::{CGEventFlags, CGEventTapLocation};
use core_graphics::event_source::CGEventSource;
use senpi_desktop_core::backend::Modifiers;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::intervention::check_press;
use senpi_desktop_core::keys::KeyName;

use super::cgevent::keyboard_event;
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

/// Builds, routes, and records one key event. A down post runs the press check
/// first; held state is recorded before a down post and cleared after a
/// successful up post, so a failed release stays replayable by `release_all`.
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
        check_press()?;
        held.key_down(HeldKey {
            route,
            code,
            text: text.map(str::to_string),
        });
    }
    let event = keyboard_event(source, code, down)?;
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

/// Types layout `keys` (a remote screen's) through `route`, pressing Shift
/// and Option as modifier KEYS only while a key needs them: a client that
/// forwards input to another machine sends modifier keys, not event flags.
/// `before_press` runs before every press, modifier presses included; when
/// it fails nothing more is pressed. Modifiers still held when a post fails
/// are released.
pub(super) fn type_layout_keys(
    source: &CGEventSource,
    held: &mut Held,
    keys: &[super::remote::TypedKey<'_>],
    gap: Duration,
    route: KeyRoute,
    before_press: &mut dyn FnMut() -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<()> {
    let mut modifiers = Modifiers::default();
    let result = (|| {
        for key in keys {
            let wanted = Modifiers { shift: key.stroke.shift, alt: key.stroke.option, ..Modifiers::default() };
            for (code, held_now, want) in [
                (super::remote::SHIFT_CODE, modifiers.shift, wanted.shift),
                (super::remote::OPTION_CODE, modifiers.alt, wanted.alt),
            ] {
                if held_now == want {
                    continue;
                }
                if want {
                    before_press()?;
                }
                let mut next = modifiers;
                if code == super::remote::SHIFT_CODE {
                    next.shift = want;
                } else {
                    next.alt = want;
                }
                post_key(source, held, code, None, want, super::cgevent::modifier_flags(next), route)?;
                modifiers = next;
                thread::sleep(gap);
            }
            before_press()?;
            let flags = super::cgevent::modifier_flags(modifiers);
            post_key(source, held, key.stroke.code, None, true, flags, route)?;
            thread::sleep(gap);
            post_key(source, held, key.stroke.code, None, false, flags, route)?;
            thread::sleep(gap);
            delivered();
        }
        Ok(())
    })();
    // Release in reverse, even after a failure; the first error wins.
    let mut release = Ok(());
    for (code, held_now) in [(super::remote::OPTION_CODE, modifiers.alt), (super::remote::SHIFT_CODE, modifiers.shift)] {
        if held_now {
            if code == super::remote::SHIFT_CODE {
                modifiers.shift = false;
            } else {
                modifiers.alt = false;
            }
            let posted = post_key(source, held, code, None, false, super::cgevent::modifier_flags(modifiers), route);
            if release.is_ok() {
                release = posted;
            }
        }
    }
    result.and(release)
}

/// Posts bare key `transitions` `(code, down)` at the HID tap from a null
/// event source, with no flag or text override, so CoreGraphics derives the
/// modifier state from the transitions exactly as for a hardware keyboard.
/// `before_press` runs before every press; once a press is refused or fails
/// nothing more is pressed, and every key this call pressed and did not yet
/// release is released in reverse order, so no key leaks to the front app
/// and no release goes out for a key that was never pressed. The first error
/// wins.
pub(super) fn post_bare_keys(
    held: &mut Held,
    transitions: &[(u16, bool)],
    gap: Duration,
    before_press: &mut dyn FnMut() -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<()> {
    let is_modifier = |code: u16| code == super::remote::SHIFT_CODE || code == super::remote::OPTION_CODE;
    let mut pressed: Vec<u16> = Vec::new();
    let result = (|| {
        for &(code, down) in transitions {
            if down {
                before_press()?;
                check_press()?;
                post_bare(code, true)?;
                // Only a press that went out is released later.
                held.key_down(HeldKey { route: KeyRoute::Global, code, text: None });
                pressed.push(code);
            } else {
                post_bare(code, false)?;
                held.key_up(KeyRoute::Global, code);
                pressed.retain(|&held_code| held_code != code);
                if !is_modifier(code) {
                    delivered();
                }
            }
            thread::sleep(gap);
        }
        Ok(())
    })();
    let mut release = Ok(());
    for code in pressed.into_iter().rev() {
        let posted = post_bare(code, false);
        if posted.is_ok() {
            held.key_up(KeyRoute::Global, code);
        } else if release.is_ok() {
            release = posted;
        }
    }
    result.and(release)
}

/// One bare key transition at the HID tap: a null source and no flag or
/// Unicode overrides (`CGEventCreateKeyboardEvent(NULL, ...)`), so
/// CoreGraphics derives the modifier state as for a hardware keyboard; the
/// event still carries the engine tag the user-input watch tells ours by
/// ([`super::cgevent::bare_keyboard_event`]).
fn post_bare(code: u16, down: bool) -> CoreResult<()> {
    let event = super::cgevent::bare_keyboard_event(code, down)?;
    event.post(CGEventTapLocation::HID);
    Ok(())
}

/// Types `text` one character at a time through `route`.
pub(super) fn type_text(
    source: &CGEventSource,
    held: &mut Held,
    text: &str,
    route: KeyRoute,
) -> CoreResult<()> {
    type_text_interruptible(source, held, text, route, &|| Ok(()), &mut || {})
}

pub(super) fn type_text_interruptible(
    source: &CGEventSource,
    held: &mut Held,
    text: &str,
    route: KeyRoute,
    check_stop: &dyn Fn() -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<()> {
    for character in text.chars() {
        check_stop()?;
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
        delivered();
    }
    Ok(())
}
