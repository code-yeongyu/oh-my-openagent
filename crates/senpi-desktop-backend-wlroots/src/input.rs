//! wtype keyboard input: text and chords through the `zwp_virtual_keyboard_v1`
//! client `wtype` is, over the subprocess seam. wtype's modifier set is
//! `shift`, `capslock`, `ctrl`, `logo` and `altgr` only — it cannot press the
//! plain Alt (Mod1) modifier, so chords naming Alt are refused with that
//! reason instead of being typed half-pressed.

use std::thread;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;

use crate::command::CommandRunner;

const WTYPE: &str = "wtype";
/// How long a poll of a running wtype child waits before re-checking the
/// stop gate. wtype owns the keys, so the stop path is: observe the gate,
/// kill the child, let the compositor's destroy-on-close release them.
const CHILD_POLL: Duration = Duration::from_millis(10);

/// Proves wtype is installed: it runs and exits non-zero printing its usage
/// when given no arguments, which types nothing. `Some` carries the reason
/// it is unavailable.
///
/// # Errors
/// The returned `DesktopError` is `InputFailed` naming the missing binary.
pub fn probe(runner: &mut impl CommandRunner) -> Option<DesktopError> {
    match runner.run(WTYPE, &[]) {
        // wtype printing its usage exits non-zero; the binary exists.
        Ok(_) | Err(crate::command::RunFailure::Exit { .. }) => None,
        Err(failure) => Some(DesktopError::input_failed(failure.message())),
    }
}

fn run(runner: &mut impl CommandRunner, args: &[String]) -> CoreResult<()> {
    runner
        .run(WTYPE, args)
        .map(|_| ())
        .map_err(|failure| DesktopError::input_failed(failure.message()))
}

/// Types `text` as one wtype argument. A payload that is exactly `-` is
/// typed through its keysym, because a bare `-` argument would make wtype
/// read stdin instead.
///
/// # Errors
/// `InputFailed` when wtype cannot run or exits non-zero.
pub fn type_text(runner: &mut impl CommandRunner, text: &str) -> CoreResult<()> {
    if text.is_empty() {
        return Ok(());
    }
    let args = if text == "-" {
        vec![
            "-P".to_owned(),
            "minus".to_owned(),
            "-p".to_owned(),
            "minus".to_owned(),
        ]
    } else {
        vec!["--".to_owned(), text.to_owned()]
    };
    run(runner, &args)
}

/// Presses every modifier, presses and releases every key, then releases
/// the modifiers, all in one wtype run so the compositor releases
/// whatever remains when wtype exits.
///
/// # Errors
/// `InvalidKey` for the Alt modifier wtype cannot press; `InputFailed`
/// when wtype cannot run or exits non-zero.
pub fn key_chord(runner: &mut impl CommandRunner, keys: &[KeyName]) -> CoreResult<()> {
    let (modifiers, plain) = split_chord(keys)?;
    if plain.is_empty() {
        return Err(DesktopError::invalid_key(
            "a key chord needs at least one non-modifier key",
        ));
    }
    let mut args = Vec::new();
    for name in &modifiers {
        args.extend(["-M".to_owned(), name.clone()]);
    }
    for name in &plain {
        args.extend(["-P".to_owned(), name.clone(), "-p".to_owned(), name.clone()]);
    }
    for name in modifiers.iter().rev() {
        args.extend(["-m".to_owned(), name.clone()]);
    }
    run(runner, &args)
}

/// Types `text` as one wtype child, checking `check_stop` before the child
/// is launched and while it runs: a refusal before the spawn sends nothing
/// at all; a stop during the run kills the child — whose exited virtual
/// keyboard releases every key it held — and surfaces the gate's error
/// instead of typing on.
///
/// # Errors
/// `check_stop`'s error when the stop gate refuses, before or during the
/// run; `InputFailed` when wtype cannot start or exits non-zero.
pub fn type_text_interruptible(
    runner: &mut impl CommandRunner,
    text: &str,
    check_stop: &dyn Fn() -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<()> {
    if text.is_empty() {
        return Ok(());
    }
    // The gate is consulted immediately before the launch, so an already
    // refusing gate spawns nothing.
    check_stop()?;
    let args = if text == "-" {
        vec![
            "-P".to_owned(),
            "minus".to_owned(),
            "-p".to_owned(),
            "minus".to_owned(),
        ]
    } else {
        vec!["--".to_owned(), text.to_owned()]
    };
    let mut child = runner
        .spawn(WTYPE, &args)
        .map_err(|failure| DesktopError::input_failed(failure.message()))?;
    loop {
        let code = child
            .try_wait()
            .map_err(|error| DesktopError::input_failed(format!("wtype: {error}")))?;
        if let Some(code) = code {
            if code == 0 {
                for _ in text.chars() {
                    delivered();
                }
                return Ok(());
            }
            return Err(DesktopError::input_failed(format!(
                "wtype exited with status {code}"
            )));
        }
        if let Err(error) = check_stop() {
            child.kill();
            return Err(error);
        }
        thread::sleep(CHILD_POLL);
    }
}

fn split_chord(keys: &[KeyName]) -> CoreResult<(Vec<String>, Vec<String>)> {
    let mut modifiers = Vec::new();
    let mut plain = Vec::new();
    for key in keys {
        match wtype_modifier(*key) {
            Some(name) => modifiers.push(name),
            None if matches!(key, KeyName::Alt) => {
                return Err(DesktopError::invalid_key(
                    "wtype cannot press the Alt modifier; it supports shift, capslock, ctrl, logo and altgr only",
                ));
            }
            None => plain.push(xkb_name(*key).ok_or_else(|| {
                DesktopError::invalid_key(format!("wtype has no keysym name for {key:?}"))
            })?),
        }
    }
    Ok((modifiers, plain))
}

/// The wtype modifier name a backend key maps to, when it is a modifier.
fn wtype_modifier(key: KeyName) -> Option<String> {
    let name = match key {
        KeyName::Ctrl => "ctrl",
        KeyName::Shift => "shift",
        KeyName::Meta => "logo",
        KeyName::CapsLock => "capslock",
        _ => return None,
    };
    Some(name.to_owned())
}

/// The XKB keysym name a backend key maps to, for wtype `-P` and for the
/// sway binding symbol the stop path matches.
#[must_use]
pub fn xkb_name(key: KeyName) -> Option<String> {
    let function = |rest: &str| Some(format!("F{rest}"));
    let name = match key {
        KeyName::Ctrl | KeyName::Alt | KeyName::Shift | KeyName::Meta | KeyName::CapsLock => {
            return None
        }
        KeyName::Enter => "Return",
        KeyName::Escape => "Escape",
        KeyName::Tab => "Tab",
        KeyName::Space => "space",
        KeyName::Backspace => "BackSpace",
        KeyName::Delete => "Delete",
        KeyName::Insert => "Insert",
        KeyName::Home => "Home",
        KeyName::End => "End",
        KeyName::PageUp => "Page_Up",
        KeyName::PageDown => "Page_Down",
        KeyName::Up => "Up",
        KeyName::Down => "Down",
        KeyName::Left => "Left",
        KeyName::Right => "Right",
        KeyName::NumLock => "Num_Lock",
        KeyName::PrintScreen => "Print",
        KeyName::Char(character) if character.is_ascii_alphanumeric() => {
            return Some(character.to_string())
        }
        KeyName::Char(_) => return None,
        KeyName::F1 => return function("1"),
        KeyName::F2 => return function("2"),
        KeyName::F3 => return function("3"),
        KeyName::F4 => return function("4"),
        KeyName::F5 => return function("5"),
        KeyName::F6 => return function("6"),
        KeyName::F7 => return function("7"),
        KeyName::F8 => return function("8"),
        KeyName::F9 => return function("9"),
        KeyName::F10 => return function("10"),
        KeyName::F11 => return function("11"),
        KeyName::F12 => return function("12"),
        KeyName::F13 => return function("13"),
        KeyName::F14 => return function("14"),
        KeyName::F15 => return function("15"),
        KeyName::F16 => return function("16"),
        KeyName::F17 => return function("17"),
        KeyName::F18 => return function("18"),
        KeyName::F19 => return function("19"),
        KeyName::F20 => return function("20"),
        KeyName::F21 => return function("21"),
        KeyName::F22 => return function("22"),
        KeyName::F23 => return function("23"),
        KeyName::F24 => return function("24"),
    };
    Some(name.to_owned())
}
