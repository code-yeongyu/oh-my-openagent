//! The guards around an AX text insertion, shared by window-level and
//! element-level typing as omp 18.13.1 shares them in `window_type`
//! (`macos/input.rs:242-255`): a terminal is never written, and right before
//! the write the run must not be stopped and, in the background, the target
//! must not have come to the front since the input began.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;

use super::key_front::EntryFront;

/// Terminal emulators: their accessibility text area is the rendered grid,
/// not the pty's input, so a write the area accepts never reaches the shell
/// (omp 18.13.1 `macos/process.rs:434-455` `is_terminal`).
const TERMINALS: [&str; 10] = [
    "co.zeit.hyper",
    "com.apple.Terminal",
    "com.github.wez.wezterm",
    "com.googlecode.iterm2",
    "com.mitchellh.ghostty",
    "dev.warp.Warp-Stable",
    "dev.zed.Zed.Helper",
    "io.alacritty",
    "net.kovidgoyal.kitty",
    "org.alacritty",
];

/// The check `insert_selected_text` runs after its probes, right before the
/// write (omp `macos/input.rs:243-246` `behind_user`, run at
/// `macos/ax.rs:1756`): a probe can block while the user brings the
/// application forward, and the write would land in the field they took over.
/// A foreground write goes to the application raised for it.
pub(super) fn before_write(
    mode: DeliveryMode,
    entry_front: EntryFront,
    front: impl FnOnce() -> Option<libc::pid_t>,
    (pid, wid): (libc::pid_t, u32),
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    check_stop()?;
    if mode == DeliveryMode::Foreground {
        return Ok(());
    }
    entry_front.require_behind(front(), pid, wid)
}

/// Runs `insert` with `behind_user` unless the target is a `terminal`, which
/// takes keys instead (omp `macos/input.rs:247-249`); `Ok(false)` means no
/// write was attempted.
pub(super) fn insert_unless_terminal<B: FnOnce() -> CoreResult<()>>(
    terminal: bool,
    behind_user: B,
    insert: impl FnOnce(B) -> CoreResult<bool>,
) -> CoreResult<bool> {
    if terminal {
        return Ok(false);
    }
    insert(behind_user)
}

pub(super) fn is_terminal(pid: libc::pid_t) -> bool {
    objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .and_then(|app| app.bundleIdentifier())
        .is_some_and(|bundle| is_terminal_bundle(&bundle.to_string()))
}

pub(super) fn is_terminal_bundle(bundle: &str) -> bool {
    TERMINALS.contains(&bundle)
}
