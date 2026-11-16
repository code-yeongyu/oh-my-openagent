//! Window and display listings: the filter a window list honours and the row each window
//! becomes.

use omo_computer_core::backend::{BackendResult, WindowFilter, WindowList};
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::results::DisplayInfo;
use omo_computer_core::untrusted::UntrustedText;

use super::geometry::{display_info, display_of};
use crate::backend::FakeBackend;
use crate::method::FakeMethod;
use crate::scenario::FakeWindow;
use crate::state::FakeState;

fn matches(filter: &WindowFilter, window: &FakeWindow) -> bool {
    filter.app.as_ref().is_none_or(|app| &window.app == app)
        && filter
            .title
            .as_ref()
            .is_none_or(|title| window.title.contains(title.as_str()))
        && filter.pid.is_none_or(|pid| window.pid == pid)
}

impl FakeBackend {
    fn window_info(&self, state: &FakeState, window: &FakeWindow, z: usize) -> WindowInfo {
        let process_start = state.process_start.get(&window.id).copied().unwrap_or(0);
        WindowInfo {
            id: window.id.clone(),
            identity: self
                .persona
                .window_identity(&window.id, window.pid, process_start),
            app: window.app.clone(),
            app_key: window.app.clone(),
            title: window.title.clone(),
            bounds: window.bounds(),
            display: display_of(state, window)
                .map(|d| d.id.clone())
                .unwrap_or_default(),
            focused: window.focused,
            is_on_screen: true,
            space: None,
            minimized: false,
            elevated: window.elevated.unwrap_or(false),
            z: u32::try_from(z).unwrap_or(u32::MAX),
            observation: UntrustedText,
        }
    }

    pub(super) fn list_windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.call(FakeMethod::Windows, |state, _| {
            let windows = state
                .windows
                .iter()
                .filter(|window| !state.exited.contains(&window.id) && matches(filter, window))
                .enumerate()
                .map(|(z, window)| self.window_info(state, window, z))
                .collect();
            Ok(WindowList {
                windows,
                truncated: false,
            })
        })
    }

    pub(super) fn list_displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.call(FakeMethod::Displays, |state, _| {
            Ok(state.displays.iter().map(display_info).collect())
        })
    }
}
