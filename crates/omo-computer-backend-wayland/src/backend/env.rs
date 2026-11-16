//! The backend the launch environment describes (d-linux.md 'Environment detection'): the
//! input route from `LIBEI_SOCKET` or the portal, and the compositor from its env signature.
//! Only rung 1 of the compositor ladder (env signatures) is read here; a compositor it cannot
//! name is `unknown` and gets the most conservative row (the D-Bus and registry rungs are row
//! 53's probes).

use std::path::PathBuf;

use omo_computer_core::capabilities::CompositorName;

use super::{InputRoute, Options, WaylandBackend};
use crate::ledger::Ledger;
use crate::portal::live::LivePortal;

/// Rung 1: compositor env signatures.
fn compositor(lookup: &dyn Fn(&str) -> Option<String>) -> CompositorName {
    if lookup("HYPRLAND_INSTANCE_SIGNATURE").is_some() {
        CompositorName::Hyprland
    } else if lookup("SWAYSOCK").is_some() {
        CompositorName::Sway
    } else {
        CompositorName::Unknown
    }
}

fn route(lookup: &dyn Fn(&str) -> Option<String>) -> InputRoute {
    if let Some(socket) = lookup("LIBEI_SOCKET").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(&socket);
        let path = if path.is_relative() {
            lookup("XDG_RUNTIME_DIR").map_or(path.clone(), |dir| PathBuf::from(dir).join(&path))
        } else {
            path
        };
        return InputRoute::Socket(path);
    }
    if lookup("WAYLAND_DISPLAY").is_none() {
        return InputRoute::Unavailable;
    }
    match LivePortal::new() {
        Ok(portal) => InputRoute::Portal(Box::new(portal)),
        Err(error) => {
            eprintln!("omo-computer-backend-wayland: portal client: {error}");
            InputRoute::Unavailable
        }
    }
}

fn consent_file(lookup: &dyn Fn(&str) -> Option<String>) -> PathBuf {
    let state = lookup("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| lookup("HOME").map(|home| PathBuf::from(home).join(".local/state")));
    state
        .unwrap_or_default()
        .join("omo/computer/wayland-consent")
}

impl WaylandBackend {
    /// The backend for the launch environment `lookup` reads.
    #[must_use]
    pub fn from_env(lookup: &dyn Fn(&str) -> Option<String>) -> Self {
        Self::new(Options {
            compositor: compositor(lookup),
            route: route(lookup),
            ledger: Ledger::shipped(),
            persist_consent: false,
            consent_file: consent_file(lookup),
            clipboard: None,
        })
    }
}
