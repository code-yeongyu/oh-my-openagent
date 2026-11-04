//! Text typed into a window in the background (`w.type`), in omp 18.13.1's
//! order (`macos/input.rs` `window_type`, `inserts_first`): AX insertion into
//! the native text element holding the window's keyboard focus first, keys
//! only when no write was attempted.
//!
//! Insertion writes `AXSelectedText`, which a text view applies as an edit of
//! its selection rather than as typed input, so the application's typing
//! substitutions (TextEdit capitalizing a sentence's first word, smart quotes,
//! text replacements) never run and the field holds exactly the text sent.
//! Keys arrive through the typing path and get them (W1b E-7). No user
//! substitution setting is read or changed.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_results::AxInputMethod;
use senpi_desktop_core::types::DesktopWindow;

use super::element::{inserts_first, report_delivered};
use super::held::KeyRoute;
use super::key_front::EntryFront;
use super::key_window::KeyWindow;
use super::{guard, keys, MacInput};
use crate::skylight;

/// Terminal emulators: their accessibility text area is the rendered grid,
/// not the pty's input, so a write the area accepts never reaches the shell
/// (omp 18.13.1 `macos/process.rs` `is_terminal`).
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

impl MacInput {
    /// Types `text` into `window`, behind the user's app; the caller runs it
    /// under [`skylight::reporting_partial`]. Insertion is an AX write: it
    /// posts nothing through SkyLight, so it runs before the receipt canary,
    /// and right before it writes, the run must not be stopped and the target
    /// must not have come to the front since `entry_front` was read. Keys go
    /// out as for any background window ([`KeyWindow`]).
    pub(super) fn type_window_background(
        &mut self,
        window: &DesktopWindow,
        (pid, wid): (libc::pid_t, u32),
        text: &str,
        entry_front: EntryFront,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        let insert = || {
            if is_terminal(pid) {
                return Ok(false);
            }
            crate::ax::insert_native_text(pid, wid, text, || {
                check_stop()?;
                entry_front.require_behind(skylight::front_pid(), pid, wid)
            })
        };
        let keys = |delivered: &mut dyn FnMut()| {
            self.background(|this| {
                guard::guard(window, "keyboard", None)?;
                let target = KeyWindow::prepare(&this.source, window, (pid, wid), entry_front)?;
                this.last_activated = Some((pid, wid));
                let check = || check_stop().and_then(|()| target.check());
                keys::type_text_interruptible(&this.source, &mut this.held, text, KeyRoute::Process(pid), &check, delivered)
            })
        };
        background_window_text(text, insert, keys, delivered).map(|_| ())
    }
}

/// Background text for a window: `insert` first; `keys` only when it
/// attempted no write. An attempted write never falls through to keys, since
/// it may already be partly in the field.
pub(super) fn background_window_text(
    text: &str,
    insert: impl FnOnce() -> CoreResult<bool>,
    keys: impl FnOnce(&mut dyn FnMut()) -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<AxInputMethod> {
    if let Some(method) = inserts_first(text, insert)? {
        report_delivered(text, delivered);
        return Ok(method);
    }
    keys(delivered).map(|()| AxInputMethod::Keys)
}

fn is_terminal(pid: libc::pid_t) -> bool {
    objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .and_then(|app| app.bundleIdentifier())
        .is_some_and(|bundle| is_terminal_bundle(&bundle.to_string()))
}

pub(super) fn is_terminal_bundle(bundle: &str) -> bool {
    TERMINALS.contains(&bundle)
}
