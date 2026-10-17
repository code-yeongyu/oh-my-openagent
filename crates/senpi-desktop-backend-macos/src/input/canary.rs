//! The SkyLight receipt canary (AD-5): once per session before the first
//! background action, deliver a marked keystroke into a real foreign dialog
//! through the authenticated SkyLight keyboard path and require it back in
//! the dialog's `text returned:` receipt, all inside a focus/cursor
//! transaction.
//!
//! The receipt vehicle is the keyboard leg, not the click leg: macOS 26
//! ignores synthetic mouse clicks on `display dialog` alerts entirely (proved
//! live for both the HID tap and the stamped SkyLight post), so the OK button
//! is dismissed through AX after the keystroke receipt proves delivery.

use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{DesktopPoint, FrontWindow};

use super::held::{self, Held};
use super::keys;
use crate::ax;
use crate::cursor;
use crate::focus;
use crate::input::MacInput;
use crate::skylight;

pub(crate) const CANARY_STOP_REASON: &str = "skylight-canary-failed";
const DIALOG_MARKER: &str = "senpi desktop canary";
/// The marker typed into the dialog's answer field through the SPI path.
const RECEIPT_MARKER: &str = "senpi-canary-ok";
/// The dialog dismisses itself after this many seconds, bounding a wedged run.
const DIALOG_GIVES_UP: &str = "5";
const DIALOG_DEADLINE: Duration = Duration::from_secs(4);
const RECEIPT_DEADLINE: Duration = Duration::from_secs(2);
const OK: &str = "OK";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CanaryMode {
    /// Run the receipt canary before the first background action.
    Session,
    /// Never run it (the `computer.macosCanary: "off"` setting).
    Off,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CanaryState {
    Pending,
    Passed,
    Failed,
    Off,
}

impl CanaryState {
    pub(super) const fn new(mode: CanaryMode) -> Self {
        match mode {
            CanaryMode::Session => Self::Pending,
            CanaryMode::Off => Self::Off,
        }
    }

    pub(super) const fn has_failed(&self) -> bool {
        matches!(self, Self::Failed)
    }

    /// Re-arms a failed canary (`/computer resume`); `Off` stays off.
    pub(super) fn rerun(&mut self) {
        if !matches!(self, Self::Off) {
            *self = Self::Pending;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanaryResult {
    pub focus_restored: bool,
}

/// The spawned dialog: its window identity and its OK button element.
struct Dialog {
    pid: libc::pid_t,
    wid: u32,
    ok_button: objc2_core_foundation::CFRetained<objc2_application_services::AXUIElement>,
}

/// Runs the canary and settles [`MacInput`]'s state from its outcome.
pub(super) fn run(input: &mut MacInput) -> CoreResult<CanaryResult> {
    skylight::require_spi()?;
    let front = focus::front_window()?;
    let cursor_before = cursor::position(&input.source)?;
    let child = Command::new("/usr/bin/osascript")
        .args([
            "-e",
            &format!(
                "display dialog \"{DIALOG_MARKER}\" default answer \"\" buttons {{\"OK\"}} \
                 default button 1 giving up after {DIALOG_GIVES_UP}"
            ),
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| DesktopError::input_failed(format!("spawning the canary dialog failed: {error}")))?;
    let delivered = deliver_and_confirm(input, child);
    let focus_restored = restore(input, front.as_ref(), cursor_before);
    let passed = delivered.is_ok() && focus_restored;
    input.settle_canary(passed);
    if passed {
        Ok(CanaryResult { focus_restored: true })
    } else {
        let detail = match delivered {
            Err(error) => format!(" {error}"),
            Ok(()) => String::new(),
        };
        Err(DesktopError::background_unavailable(format!(
            "{CANARY_STOP_REASON}: the background SPI path did not produce a dialog receipt or \
             could not restore focus;{detail} retry with delivery:\"foreground\" or use ax actions",
        )))
    }
}

fn deliver_and_confirm(input: &mut MacInput, mut child: std::process::Child) -> CoreResult<()> {
    let dialog = wait_for_dialog(i32::try_from(child.id()).unwrap_or(-1))
        .ok_or_else(|| DesktopError::input_failed("the canary dialog never exposed its OK button"))?;
    skylight::activate_without_raise(dialog.pid, dialog.wid)?;
    keys::type_text(
        &input.source,
        &mut Held::default(),
        RECEIPT_MARKER,
        held::KeyRoute::Process(dialog.pid),
    )?;
    // macOS 26 ignores synthetic clicks on these alerts, so the deterministic
    // dismissal runs through AX after the keystroke receipt path is proven.
    // A busy app can refuse the press once (kAXErrorCannotComplete), so the
    // bounded retry keeps the once-per-session canary from failing spuriously.
    let mut pressed = crate::ax::press(&dialog.ok_button);
    for _ in 0..3 {
        if pressed.is_ok() {
            break;
        }
        thread::sleep(Duration::from_millis(150));
        pressed = crate::ax::press(&dialog.ok_button);
    }
    pressed?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let receipt = child
                    .wait_with_output()
                    .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
                    .unwrap_or_default();
                return if receipt.contains(&format!("text returned:{RECEIPT_MARKER}")) {
                    Ok(())
                } else {
                    Err(DesktopError::input_failed(format!(
                        "the canary dialog reply carried no typed-marker receipt: {}",
                        receipt.trim()
                    )))
                };
            }
            Ok(None) if started.elapsed() < RECEIPT_DEADLINE => {
                thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                let _ = child.kill();
                return Err(DesktopError::input_failed(
                    "the canary dialog did not dismiss within the receipt deadline",
                ));
            }
            Err(error) => {
                return Err(DesktopError::input_failed(format!(
                    "waiting for the canary dialog failed: {error}"
                )))
            }
        }
    }
}

/// Puts the front window and cursor back after the dialog; `true` when every
/// restoration ran and the front window matches what was captured.
fn restore(input: &mut MacInput, front: Option<&FrontWindow>, before: Option<DesktopPoint>) -> bool {
    let mut restored = true;
    if let Some(front) = front {
        restored &= focus::restore_key_focus(input, front).is_ok();
        restored &= focus::restore_front_window(front).is_ok();
        restored &= focus::front_window()
            .ok()
            .flatten()
            .is_some_and(|after| after.pid == front.pid);
    }
    if let Some(before) = before {
        if let Some(current) = cursor::position(&input.source).ok().flatten() {
            let moved = (current.x - before.x).abs() > 0.5 || (current.y - before.y).abs() > 0.5;
            restored &= !moved || cursor::warp(&input.source, before).is_ok();
        }
    }
    restored
}

/// Finds the canary dialog: an `AXDialog` window carrying the marker text,
/// together with its OK button's center. The spawned `osascript` pid is tried
/// first; any other `osascript` process is a fallback for hosts where the
/// dialog lands in a forked child.
fn wait_for_dialog(spawned: libc::pid_t) -> Option<Dialog> {
    let started = Instant::now();
    loop {
        if let Some(dialog) = find_dialog(spawned) {
            return Some(dialog);
        }
        if started.elapsed() >= DIALOG_DEADLINE {
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn find_dialog(spawned: libc::pid_t) -> Option<Dialog> {
    let mut candidates = vec![spawned];
    candidates.extend(osascript_pids().into_iter().filter(|pid| *pid != spawned));
    for pid in candidates {
        let Ok(application) = ax::element::create_application(pid) else {
            continue;
        };
        // Bound every AX exchange so one stale process cannot eat the deadline.
        let _ = ax::element::set_timeout(&application);
        for window in ax::element::copy_elements(&application, "AXWindows").unwrap_or_default() {
            let Some(dialog) = dialog_of(&window, pid) else {
                continue;
            };
            return Some(dialog);
        }
    }
    None
}

/// The marked dialog window and its OK button, or `None` for any other window.
fn dialog_of(window: &objc2_application_services::AXUIElement, pid: libc::pid_t) -> Option<Dialog> {
    let children = ax::element::copy_elements(window, "AXChildren").unwrap_or_default();
    let marked = children.iter().any(|child| {
        ax::element::copy_string(child, "AXRole").as_deref() == Some("AXStaticText")
            && ax::element::copy_string(child, "AXValue").is_some_and(|value| value.contains(DIALOG_MARKER))
    });
    if !marked {
        return None;
    }
    let ok = children.iter().find(|child| {
        ax::element::copy_string(child, "AXRole").as_deref() == Some("AXButton")
            && (ax::element::copy_string(child, "AXTitle").as_deref() == Some(OK)
                || ax::element::copy_string(child, "AXDescription").as_deref() == Some(OK))
    })?;
    let wid = ax::element::window_id(window).unwrap_or(0);
    Some(Dialog {
        pid,
        wid,
        ok_button: ok.clone(),
    })
}

/// Every running `osascript` process: the dialog can be hosted by a forked
/// child of the one this backend spawned, so the search cannot key on the
/// spawned pid alone.
fn osascript_pids() -> Vec<libc::pid_t> {
    // SAFETY: A null-buffer call is the documented sizing probe.
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
        return Vec::new();
    }
    let mut pids = vec![0i32; count as usize];
    // SAFETY: `pids` provides `count` writable pid slots.
    let written = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), count) };
    if written <= 0 {
        return Vec::new();
    }
    pids.truncate(written as usize);
    pids.into_iter()
        .filter(|pid| process_name(*pid) == "osascript")
        .collect()
}

/// The short process name libproc reports for `pid`.
fn process_name(pid: libc::pid_t) -> String {
    let mut buffer = [0u8; 64];
    // SAFETY: `buffer` is writable scratch memory for the name bytes.
    let len = unsafe { libc::proc_name(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf8_lossy(&buffer[..len as usize]).into_owned()
}
