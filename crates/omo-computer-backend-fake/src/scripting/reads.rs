//! Scripted reads: they change nothing on the desktop, so they never touch the sink.

use omo_computer_core::params::Point;

use crate::backend::FakeBackend;
use crate::scenario::{FakeMenuNode, RemoteForwarding, ScriptedHit};
use crate::timeline::UserInput;

/// One key-priming focus read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FocusReadResult {
    pub focused_window: String,
    pub focused_element_window: String,
}

impl FakeBackend {
    /// The window's owning `(pid, processStart)`; `None` for an unknown or exited window.
    #[must_use]
    pub fn identity(&self, window: &str) -> Option<(u32, u64)> {
        let state = self.lock();
        let found = state.live_window(window)?;
        Some((
            found.pid,
            state.process_start.get(window).copied().unwrap_or(0),
        ))
    }

    /// The next scripted focus read for `window`; once they run out, the focused window.
    #[must_use]
    pub fn focus_read(&self, window: &str) -> FocusReadResult {
        let mut state = self.lock();
        let position = state.focus_read_pos.get(window).copied().unwrap_or(0);
        let scripted = state
            .scenario
            .focus_reads
            .iter()
            .filter(|read| read.window == window)
            .nth(position)
            .cloned();
        if let Some(read) = scripted {
            state.focus_read_pos.insert(window.to_owned(), position + 1);
            return FocusReadResult {
                focused_window: read.focused_window,
                focused_element_window: read.focused_element_window,
            };
        }
        let focused = state
            .windows
            .iter()
            .find(|candidate| candidate.focused)
            .map(|candidate| candidate.id.clone())
            .unwrap_or_default();
        FocusReadResult {
            focused_window: focused.clone(),
            focused_element_window: focused,
        }
    }

    /// The element scripted exactly at `point`.
    #[must_use]
    pub fn hit_at(&self, point: Point) -> Option<ScriptedHit> {
        self.lock()
            .scenario
            .hit_at
            .iter()
            .find(|hit| {
                (hit.x - point.x).abs() < f64::EPSILON && (hit.y - point.y).abs() < f64::EPSILON
            })
            .cloned()
    }

    /// The scripted frontmost pid, else the focused window's.
    #[must_use]
    pub fn frontmost_pid(&self) -> Option<u32> {
        let state = self.lock();
        state.scenario.frontmost_pid.or_else(|| {
            state
                .windows
                .iter()
                .find(|window| window.focused)
                .map(|window| window.pid)
        })
    }

    #[must_use]
    pub fn cursor(&self) -> Option<Point> {
        self.lock().cursor
    }

    #[must_use]
    pub fn menus(&self, window: &str) -> Option<Vec<FakeMenuNode>> {
        self.lock().scenario.menus.get(window).cloned()
    }

    /// How a remote-screen client of `pid` forwards input, if its windows show one.
    #[must_use]
    pub fn remote_screen(&self, pid: u32) -> Option<RemoteForwarding> {
        self.lock().scenario.remote_screens.get(&pid).copied()
    }

    /// Captures carry the legacy frame geometry.
    #[must_use]
    pub fn legacy_capture(&self) -> bool {
        self.lock().scenario.legacy_capture
    }

    /// The stop marker present at engine start, by path.
    #[must_use]
    pub fn stop_marker(&self) -> Option<String> {
        self.lock().scenario.stop_marker.clone()
    }

    /// User inputs the feed has reported up to the clock's current time, oldest first.
    #[must_use]
    pub fn user_inputs(&self) -> Vec<UserInput> {
        let state = self.lock();
        let now = i64::try_from(self.clock.now_ms()).unwrap_or(i64::MAX);
        let mut inputs: Vec<UserInput> = state
            .user_inputs
            .iter()
            .filter(|input| input.at_ms <= now)
            .cloned()
            .collect();
        inputs.sort_by_key(|input| input.at_ms);
        inputs
    }

    /// Whether `window`'s process has exited.
    #[must_use]
    pub fn exited(&self, window: &str) -> bool {
        self.lock().exited.contains(window)
    }
}
