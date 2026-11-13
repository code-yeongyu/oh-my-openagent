//! Independent observers: spawned `osascript` (JXA) processes read the
//! frontmost app and the cursor, and a prebuilt AX observer binary (path in
//! `SENPI_DESKTOP_AX_OBSERVER`) reads the focused-window title and Terminal's
//! buffer through the AX C API. Every fact the live tests assert comes from
//! these processes, never from the backend's own state.
//!
//! The title/buffer reads go through the helper binary rather than System
//! Events because the QA launcher's System Events automation is user-denied;
//! both processes are equally independent of the backend under test.

use std::process::Command;
use std::time::{Duration, Instant};

/// Hang guard for observer polls; the observed state is a genuine OS boundary.
const OBSERVER_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct Frontmost {
    pub pid: i32,
    pub name: String,
    pub focused_title: String,
}

fn osascript_jxa(script: &str) -> Option<String> {
    let output = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn ax_observer(args: &[&str]) -> Option<String> {
    let path = std::env::var("SENPI_DESKTOP_AX_OBSERVER").ok()?;
    let output = Command::new(path).args(args).output().ok()?;
    Some(
        String::from_utf8_lossy(&output.stdout)
            .trim_end_matches('\n')
            .to_string(),
    )
}

/// `pid|name` of the frontmost application plus its AX focused-window title.
pub(super) fn frontmost() -> Option<Frontmost> {
    let script = r#"ObjC.import("AppKit"); const a = $.NSWorkspace.sharedWorkspace.frontmostApplication; `${a.processIdentifier}|${a.localizedName.js}`"#;
    let line = osascript_jxa(script)?;
    let (pid, name) = line.split_once('|')?;
    let pid: i32 = pid.parse().ok()?;
    let focused_title = ax_observer(&["focused-title", &pid.to_string()]).unwrap_or_default();
    Some(Frontmost {
        pid,
        name: name.to_string(),
        focused_title,
    })
}

/// The cursor through the AX observer binary's `CGEventCreate` probe (global
/// top-left coordinates, the same system the backend's warp uses).
pub(super) fn cursor() -> Option<(f64, f64)> {
    let line = ax_observer(&["cursor"])?;
    let (x, y) = line.split_once(',')?;
    Some((x.parse().ok()?, y.parse().ok()?))
}

/// The visible buffer of Terminal's focused window, through the AX observer.
pub(super) fn terminal_buffer(pid: i32) -> Option<String> {
    ax_observer(&["text-area-value", &pid.to_string()])
}

/// Waits until Terminal's buffer contains `fragment`; returns the buffer.
pub(super) fn wait_terminal_contains(pid: i32, fragment: &str) -> Option<String> {
    let started = Instant::now();
    loop {
        let buffer = terminal_buffer(pid).unwrap_or_default();
        if buffer.contains(fragment) {
            return Some(buffer);
        }
        if started.elapsed() >= OBSERVER_DEADLINE {
            return None;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "live: observer probe against the real window server"]
    fn observer_reads_frontmost_and_cursor() {
        let front = frontmost().expect("frontmost observer");
        let (x, y) = cursor().expect("cursor observer");
        println!("frontmost={front:?} cursor=({x},{y})");
    }
}
