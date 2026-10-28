//! Processes whose accessibility text is not their input: a terminal's AX
//! text area represents its rendered grid, not the pty, so even a successful
//! `AXSelectedText` or `AXValue` write is no proof that the shell received
//! it (ported from oh-my-pi 0838d2ab44 `process::is_terminal`).

use objc2_app_kit::NSRunningApplication;

/// Whether `pid` is a known terminal emulator, by bundle identifier.
pub(crate) fn is_terminal(pid: libc::pid_t) -> bool {
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        .and_then(|app| app.bundleIdentifier())
        .is_some_and(|bundle| is_terminal_bundle(&bundle.to_string()))
}

/// The bundle identifiers of the terminal emulators whose AX text is a grid.
pub(crate) fn is_terminal_bundle(bundle: &str) -> bool {
    matches!(
        bundle,
        "co.zeit.hyper"
            | "com.apple.Terminal"
            | "com.github.wez.wezterm"
            | "com.googlecode.iterm2"
            | "com.mitchellh.ghostty"
            | "dev.warp.Warp-Stable"
            | "dev.zed.Zed.Helper"
            | "io.alacritty"
            | "net.kovidgoyal.kitty"
            | "org.alacritty"
    )
}

#[cfg(test)]
mod tests {
    use super::is_terminal_bundle;

    #[test]
    fn terminal_emulators_are_known_by_bundle_id() {
        assert!(is_terminal_bundle("com.apple.Terminal"));
        assert!(is_terminal_bundle("com.googlecode.iterm2"));
        assert!(!is_terminal_bundle("com.apple.TextEdit"));
        assert!(!is_terminal_bundle(""));
    }
}
