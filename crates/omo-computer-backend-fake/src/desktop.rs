//! `Backend` for the fake: listings, capture and the one input sink, all scripted.

use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, InputEvent,
    PermissionProbe, Presence, Refusal, Route, StopListener, TaggedInput, Target, WindowFilter,
    WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::intervention::{BackendClock, InterventionSource, TextDelivery};
use omo_computer_core::listing::WindowInfo;
use omo_computer_core::observation::ImageMime;
use omo_computer_core::results::{DisplayInfo, PermissionState};
use omo_computer_core::session_state::Tristate;
use omo_computer_core::untrusted::UntrustedText;

use crate::backend::{FakeBackend, StopPathScript};
use crate::capabilities::fake_capabilities;
use crate::frame::{pixels, Raster};
use crate::handles::{FakeEpochSource, FakePresence, FakeStopListener};
use crate::method::FakeMethod;
use crate::scenario::FakeWindow;
use crate::state::FakeState;

/// The most pixels one capture may hold: the composite cap of the design's
/// `d-vision.md` '## Screenshot pipeline' (`MAX_COMPOSITE_PIXELS` = 268,435,456). Row 12's
/// limits table carries no pixel cap, so the fake names it here; the frame row owns the
/// engine's own copy.
pub const MAX_COMPOSITE_PIXELS: u64 = 268_435_456;

use geometry::{capture_rect, display_info, display_of, event_line, matches};

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
}

impl Backend for FakeBackend {
    fn capabilities(&self) -> Capabilities {
        let displays = self.lock().displays.len();
        let mut capabilities = self.with_scripted_session(fake_capabilities(self.persona, displays, self.stop_path));
        let state = self.lock();
        // Secure Input: scripted on (`secure_input_on`), or a scripted secure focus while its
        // window is the focused, live one. Neither declared keeps today's value.
        let input_on = state.scenario.secure_input_on;
        let focused = state.scenario.secure_focus.as_ref().map(|secure| {
            state.windows.iter().any(|window| {
                window.focused && window.id == secure.window && !state.exited.contains(&window.id)
            })
        });
        if input_on || focused.is_some() {
            capabilities.session.secure_input_active =
                Tristate::Known(input_on || focused == Some(true));
        }
        capabilities
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
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

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.call(FakeMethod::Displays, |state, _| {
            Ok(state.displays.iter().map(display_info).collect())
        })
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        self.call(FakeMethod::Capture, |state, _| {
            let (rect, scale) = capture_rect(state, target)?;
            let rect = options.region.unwrap_or(rect);
            // A scale that is not positive, or a negative size, refuses before the multiply:
            // two negatives would otherwise make a positive extent.
            if scale.is_nan() || scale <= 0.0 || rect.width < 0.0 || rect.height < 0.0 {
                return Err(Refusal::bare(EngineCode::CaptureFailed));
            }
            let (scaled_width, scaled_height) = (rect.width * scale, rect.height * scale);
            // `pixels` truncates to whole pixels and maps a non-finite length to 0, so a
            // non-finite extent refuses here and any length under 1 px refuses as 0 below.
            if !scaled_width.is_finite() || !scaled_height.is_finite() {
                return Err(Refusal::bare(EngineCode::CaptureFailed));
            }
            let (width, height) = (pixels(scaled_width), pixels(scaled_height));
            if width == 0
                || height == 0
                || u64::from(width) * u64::from(height) > MAX_COMPOSITE_PIXELS
            {
                return Err(Refusal::bare(EngineCode::CaptureFailed));
            }
            let gray = if state.scenario.legacy_capture {
                0x60
            } else {
                0xA0
            };
            let mut raster = Raster::filled(width, height, gray);
            // The pointer is in the frame by default (`cursor:false` leaves it out), drawn at
            // the cursor's native pixel; the crosshair is drawn at the frame point it names.
            if let Some(cursor) = state.cursor.filter(|_| options.cursor) {
                raster.pointer((cursor.x - rect.x) * scale, (cursor.y - rect.y) * scale);
            }
            if let Some(at) = options.crosshair {
                raster.crosshair(at.x, at.y);
            }
            Ok(FrameBytes {
                width,
                height,
                mime: ImageMime::Png,
                bytes: raster.png(),
            })
        })
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.call(FakeMethod::of_input(&input.event), |state, _| {
            if let Some(capped) = posts::count(state, &input.event) {
                return Ok(capped);
            }
            match &input.event {
                InputEvent::PointerMove(point) => state.cursor = Some(*point),
                InputEvent::Key { key, down: true } => {
                    state.held.insert(key.clone());
                }
                InputEvent::Key { key, down: false } => {
                    state.held.remove(key);
                }
                _ => {}
            }
            let route = format!("{route:?}").to_lowercase();
            self.sink.record(format!(
                "post_input route={route} tag={} {}",
                input.tag,
                event_line(&input.event)
            ));
            Ok(Delivered { count: 1, of: 1 })
        })
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        match self.stop_path {
            StopPathScript::None => Err(Refusal::new(
                EngineCode::StopPathUnavailable,
                Reason::NoListener.wire(),
            )),
            script => Ok(Box::new(FakeStopListener::new(self.shared.clone(), script))),
        }
    }

    fn probe_permissions(&self) -> PermissionProbe {
        PermissionProbe {
            capture: PermissionState::Granted,
            input: PermissionState::Granted,
            accessibility: PermissionState::Granted,
        }
    }

    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        Box::new(FakeEpochSource::new(self.shared.clone()))
    }

    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        let available = self.lock().scenario.presence_surface.unwrap_or(true);
        available.then(|| Box::new(FakePresence::new(self.sink.clone())) as Box<dyn Presence>)
    }

    fn clock(&self) -> Option<&dyn BackendClock> {
        Some(&self.clock)
    }

    fn intervention(&self) -> Option<&dyn InterventionSource> {
        Some(self)
    }

    fn user_held_keys(&self) -> Vec<String> {
        self.lock().scenario.held_keys.clone()
    }

    fn pointer(&self) -> Option<omo_computer_core::params::Point> {
        self.lock().cursor
    }

    fn ax(&mut self) -> Option<&mut dyn omo_computer_core::backend::AxBackend> {
        Some(self)
    }

    fn clipboard_read(&mut self) -> BackendResult<omo_computer_core::clipboard::ClipboardRead> {
        Ok(match FakeBackend::clipboard_read(self)? {
            crate::scripting::ClipboardRead::Concealed => omo_computer_core::clipboard::ClipboardRead::Concealed,
            crate::scripting::ClipboardRead::Text(text) => omo_computer_core::clipboard::ClipboardRead::Text(text),
        })
    }

    fn clipboard_write(&mut self, text: &str) -> BackendResult<()> {
        FakeBackend::clipboard_write(self, text)
    }

    fn secure_focus(&self, window: Option<&str>) -> Option<bool> {
        Some(window.map_or_else(|| FakeBackend::secure_focus_role(self).is_some(), |window| FakeBackend::secure_focus(self, window)))
    }

    fn quit_app(&mut self, app: &str) -> BackendResult<Delivered> {
        let mut state = self.lock();
        let ids: Vec<String> = state.windows.iter().filter(|w| w.app == app).map(|w| w.id.clone()).collect();
        for id in ids {
            state.exited.insert(id);
        }
        drop(state);
        self.sink.record(format!("quit_app app={app}"));
        Ok(Delivered { count: 1, of: 1 })
    }

    fn frame_settable(&self, window: &str) -> Option<bool> {
        self.lock().scenario.window_frame_policy.get(window).and_then(|policy| policy.settable)
    }

    fn set_frame(&mut self, window: &str, frame: omo_computer_core::listing::Rect) -> BackendResult<omo_computer_core::window_frame::FrameApplied> {
        let applied = FakeBackend::set_frame(self, window, frame)?;
        Ok(omo_computer_core::window_frame::FrameApplied { frame: applied.frame, immovable: applied.immovable })
    }

    fn post_text(
        &mut self,
        text: &str,
        route: Route,
        tag: u64,
        interrupt: &mut dyn FnMut(&dyn Backend) -> bool,
    ) -> TextDelivery {
        self.type_interruptible(text, route, tag, interrupt)
    }

    fn ax_reader(&mut self) -> Option<&mut dyn omo_computer_core::ax::AxReader> {
        Some(self)
    }

    // --- Row 21: the scripted code identity per pid and the fake host's consent view. ---

    fn code_identity(&self, pid: u32) -> Option<omo_computer_core::listing::CodeIdentity> {
        FakeBackend::code_identity(self, pid)
    }

    /// The scenario's `consent` view, with `fullAccess` set under the full-access preset.
    fn host_consent(&self) -> Option<serde_json::Value> {
        let state = self.lock();
        let mut view = state.scenario.consent.clone();
        if state.scenario.full_access_preset {
            if let Some(map) = view.get_or_insert_with(|| serde_json::json!({})).as_object_mut() {
                map.insert("fullAccess".to_owned(), serde_json::Value::Bool(true));
            }
        }
        view
    }
}


mod geometry;
mod posts;

#[cfg(test)]
mod extent_tests;
#[cfg(test)]
mod tests;
