//! Optional display-only helper shared by native input, AX and capture.
mod client;
mod coordination;
mod helper;
mod motion;
mod panel;
mod wire;

use super::focus;
use client::Helper;
use parking_lot::Mutex;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use std::sync::Arc;
use std::path::Path;
use std::time::Duration;
use wire::Command;

pub(crate) use helper::run;
pub(crate) use coordination::path as lock_path;

/// WindowServer identity shared by every session's private overlay helper.
pub(crate) const WINDOW_TITLE: &str = "senpi-desktop-cursor-overlay";
/// Window level of the helper panel; together with the title it identifies a helper.
pub(crate) const WINDOW_LEVEL: i32 = 1000;

#[derive(Debug, Default)]
struct State {
    helper: Option<Helper>,
    token: u64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Overlay(Arc<Mutex<State>>);

impl Overlay {
    pub fn configure(&self, enabled: bool) {
        self.configure_for(enabled, crate::capture::filtered_capture_supported());
    }

    /// Capture must exclude a visible helper per frame; without that API (macOS < 14)
    /// every screenshot taken while the helper is up would fail, so it is never started.
    pub(crate) fn configure_for(&self, enabled: bool, exclusion_supported: bool) {
        let mut state = self.0.lock();
        state.helper = None;
        if enabled && !exclusion_supported {
            eprintln!("cursor-overlay: unavailable: per-frame capture exclusion requires macOS 14 or later");
        } else if enabled {
            match Helper::start() {
                Ok(helper) => {
                    state.helper = Some(helper);
                }
                Err(error) => eprintln!("cursor-overlay: unavailable: {error}"),
            }
        }
    }

    pub fn available(&self) -> bool {
        let mut state = self.0.lock();
        let Some(helper) = state.helper.as_mut() else {
            return false;
        };
        match helper.running() {
            Ok(true) => true,
            Ok(false) => {
                state.helper = None;
                false
            }
            Err(error) => {
                eprintln!("cursor-overlay: liveness check failed; disabling: {error}");
                state.helper = None;
                false
            }
        }
    }

    #[cfg(test)]
    pub fn owner_pid(&self) -> Option<u32> {
        if !self.available() {
            return None;
        }
        self.0.lock().helper.as_ref().map(Helper::pid)
    }

    pub fn target(&self, x: f64, y: f64) {
        let mut state = self.0.lock();
        state.token = state.token.wrapping_add(1);
        let token = state.token;
        if let Some(helper) = state.helper.as_mut() {
            if let Err(error) = helper.send(Command::Target { token, x, y }) {
                eprintln!("cursor-overlay: input display disabled: {error}");
                state.helper = None;
            }
        }
    }

    /// Freeze first publication of new helper windows while native capture excludes known IDs.
    pub fn capture<T>(
        &self,
        path: &Path,
        window_info: impl FnOnce() -> CoreResult<Vec<focus::WindowInfo>>,
        wait: impl FnMut(Duration),
        capture: impl FnOnce(&[u32]) -> CoreResult<T>,
    ) -> CoreResult<T> {
        // Existing helpers may keep animating: their window IDs are excluded at the compositor.
        // The exclusive scope blocks only first publication, not visible-lifetime locks.
        let _capture = coordination::open(path)
            .and_then(|file| coordination::capture(file, wait))
            .map_err(|error| {
                DesktopError::capture_failed(format!(
                    "cursor exclusion lock '{}' unavailable; capture refused: {error}",
                    path.display()
                ))
            })?;
        let windows = window_info().map_err(|error| {
            DesktopError::capture_failed(format!("cannot verify cursor exclusion: {error}"))
        })?;
        capture(&excluded_window_ids(&windows)?)
    }
}

fn excluded_window_ids(windows: &[focus::WindowInfo]) -> CoreResult<Vec<u32>> {
    let mut ids = Vec::new();
    for window in windows.iter().filter(|window| window.cursor_overlay) {
        if window.window_number == 0 || window.pid == 0 {
            return Err(DesktopError::capture_failed(
                "a cursor overlay cannot be identified for exclusion; capture refused",
            ));
        }
        ids.push(window.window_number);
    }
    Ok(ids)
}

#[cfg(test)]
mod motion_tests;

#[cfg(test)]
#[path = "visibility_tests.rs"]
mod visibility_tests;

#[cfg(test)]
mod orchestration_tests;

#[cfg(test)]
mod capture_budget_tests;

#[cfg(test)]
mod account_path_tests;

#[cfg(test)]
mod exclusion_gate_tests;
