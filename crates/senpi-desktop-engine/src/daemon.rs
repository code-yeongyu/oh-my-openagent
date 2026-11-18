//! The `--serve` daemon session rule: with no co-located host, the daemon
//! opens its own session from its CLI flags, arms its stop paths at once, and
//! then (after the bind, see [`crate::serve::Bound::write_token`]) leaves the
//! resume token in a 0600 file only the desktop user can read, for
//! `senpi-desktop-engine --resume`.

use std::path::PathBuf;

use senpi_desktop_core::types::{CaptureCaps, DesktopSessionOptions};
use senpi_desktop_safety::{Chord, StopPolicy};

use crate::engine::{Engine, SessionCall};

#[derive(Debug, Clone, Default)]
pub struct DaemonOptions {
    pub audit_path: Option<PathBuf>,
    pub artifact_dir: Option<PathBuf>,
    pub max_width: Option<u32>,
    pub max_height: Option<u32>,
    pub max_bytes: Option<u64>,
    pub display: Option<String>,
    pub stop_chord: Option<String>,
    pub allow_host_relay_only_stop: bool,
}

impl DaemonOptions {
    fn session(&self) -> DesktopSessionOptions {
        let defaults = CaptureCaps::default();
        DesktopSessionOptions {
            display: self.display.clone(),
            allow_host_relay_only_stop: self.allow_host_relay_only_stop,
            audit_path: self.audit_path.clone(),
            artifact_dir: self.artifact_dir.clone(),
            capture_caps: CaptureCaps {
                max_width: self.max_width.or(defaults.max_width),
                max_height: self.max_height.or(defaults.max_height),
                max_bytes: self.max_bytes.unwrap_or(defaults.max_bytes),
                ..defaults
            },
            ..DesktopSessionOptions::default()
        }
    }
}

/// Opens the daemon's own session and arms its stop paths.
///
/// # Errors
/// The chord is invalid or the session does not open.
pub async fn open_daemon_session(engine: &Engine, options: &DaemonOptions) -> Result<(), String> {
    let chord_text = options
        .stop_chord
        .clone()
        .unwrap_or_else(|| default_stop_chord().to_owned());
    let chord = Chord::parse(&chord_text).map_err(|error| format!("--stop-chord {chord_text}: {error}"))?;
    engine.stop_paths().set_policy(StopPolicy {
        allow_host_relay_only: options.allow_host_relay_only_stop,
    });
    engine
        .begin(SessionCall::Open(options.session()))
        .wait()
        .await
        .map_err(|failure| format!("the daemon session did not open: {failure:?}"))?;
    engine.stop_paths().start(&chord);
    engine.announce_stop_path();
    Ok(())
}

/// The per-OS default stop chord (the `computer.stopHotkey` default).
pub const fn default_stop_chord() -> &'static str {
    if cfg!(target_os = "macos") {
        "ctrl+opt+cmd+escape"
    } else {
        "ctrl+alt+shift+escape"
    }
}
