//! Optional display-only helper shared by native input, AX and capture.
mod client;
mod helper;
mod motion;
mod panel;
mod wire;

use super::focus;
use client::Helper;
use parking_lot::Mutex;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use std::sync::Arc;
use wire::Command;

pub(crate) use helper::run;

#[derive(Debug, Default)]
struct State {
    helper: Option<Helper>,
    /// Retain after failure until WindowServer confirms disappearance.
    pid: Option<u32>,
    token: u64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Overlay(Arc<Mutex<State>>);

impl Overlay {
    pub fn configure(&self, enabled: bool) {
        let mut state = self.0.lock();
        state.helper = None;
        if enabled {
            match Helper::start() {
                Ok(helper) => {
                    state.pid = Some(helper.pid());
                    state.helper = Some(helper);
                }
                Err(error) => eprintln!("cursor-overlay: unavailable: {error}"),
            }
        }
    }

    pub fn available(&self) -> bool {
        self.0.lock().helper.is_some()
    }

    pub fn owner_pid(&self) -> Option<u32> {
        self.0.lock().pid
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

    /// One hide/ACK scope for every capture route, including fallbacks.
    /// If hiding fails, kill/reap first; refuse pixels if a window remains.
    pub fn capture<T>(&self, capture: impl FnOnce() -> CoreResult<T>) -> CoreResult<T> {
        let token = {
            let mut state = self.0.lock();
            state.token = state.token.wrapping_add(1);
            let token = state.token;
            if let Some(helper) = state.helper.as_mut() {
                match helper.send(Command::Hide { token }) {
                    Ok(reply) if !reply.visible => {}
                    Ok(_) => state.helper = None,
                    Err(error) => {
                        eprintln!(
                            "cursor-overlay: hide failed; terminating before capture: {error}"
                        );
                        state.helper = None;
                    }
                }
            }
            if let Some(pid) = state.pid {
                let windows = focus::window_info().map_err(|error| {
                    DesktopError::capture_failed(format!("cannot verify cursor exclusion: {error}"))
                })?;
                if windows
                    .iter()
                    .any(|window| window.pid == pid && window.on_screen)
                {
                    return Err(DesktopError::capture_failed(
                        "cursor overlay is still visible; capture refused",
                    ));
                }
            }
            token
        };
        let _hidden = Hidden {
            overlay: self.clone(),
            token,
        };
        capture()
    }
}

struct Hidden {
    overlay: Overlay,
    token: u64,
}

impl Drop for Hidden {
    fn drop(&mut self) {
        let mut state = self.overlay.0.lock();
        if let Some(helper) = state.helper.as_mut() {
            if let Err(error) = helper.send(Command::Resume { token: self.token }) {
                eprintln!("cursor-overlay: resume failed; disabling: {error}");
                state.helper = None;
            }
        }
    }
}

#[cfg(test)]
mod motion_tests;
