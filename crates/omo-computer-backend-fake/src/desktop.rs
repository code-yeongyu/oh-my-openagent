//! `Backend` for the fake: listings, capture and the one input sink, all scripted.

use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, InputEvent,
    PermissionProbe, Presence, Refusal, Route, StopListener, TaggedInput, Target, WindowFilter,
    WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::intervention::{BackendClock, InterventionSource, TextDelivery};
use omo_computer_core::listing::{Rect, WindowInfo};
use omo_computer_core::observation::ImageMime;
use omo_computer_core::results::{DisplayInfo, PermissionState};
use omo_computer_core::untrusted::UntrustedText;

use crate::backend::{FakeBackend, StopPathScript};
use crate::capabilities::fake_capabilities;
use crate::frame::{pixels, Raster};
use crate::handles::{FakeEpochSource, FakePresence, FakeStopListener};
use crate::method::FakeMethod;
use crate::scenario::{FakeDisplay, FakeWindow};
use crate::sink::quoted;
use crate::state::FakeState;

/// The most pixels one capture may hold: the composite cap of the design's
/// `d-vision.md` '## Screenshot pipeline' (`MAX_COMPOSITE_PIXELS` = 268,435,456). Row 12's
/// limits table carries no pixel cap, so the fake names it here; the frame row owns the
/// engine's own copy.
pub const MAX_COMPOSITE_PIXELS: u64 = 268_435_456;

fn display_info(display: &FakeDisplay) -> DisplayInfo {
    DisplayInfo {
        id: display.id.clone(),
        bounds: Rect {
            x: display.x,
            y: display.y,
            width: display.width,
            height: display.height,
        },
        scale: display.scale,
        primary: display.is_primary,
        truncated: None,
    }
}

fn contains(display: &FakeDisplay, x: f64, y: f64) -> bool {
    x >= display.x
        && y >= display.y
        && x < display.x + display.width
        && y < display.y + display.height
}

fn display_of<'a>(state: &'a FakeState, window: &FakeWindow) -> Option<&'a FakeDisplay> {
    state
        .displays
        .iter()
        .find(|display| contains(display, window.x, window.y))
        .or_else(|| state.displays.first())
}

fn matches(filter: &WindowFilter, window: &FakeWindow) -> bool {
    filter.app.as_ref().is_none_or(|app| &window.app == app)
        && filter
            .title
            .as_ref()
            .is_none_or(|title| window.title.contains(title.as_str()))
        && filter.pid.is_none_or(|pid| window.pid == pid)
}

fn event_line(event: &InputEvent) -> String {
    match event {
        InputEvent::PointerMove(point) => format!("pointer_move x={} y={}", point.x, point.y),
        InputEvent::Button { button, down } => {
            format!("button {button:?} down={down}").to_lowercase()
        }
        InputEvent::Key { key, down } => format!("key {} down={down}", quoted(key)),
        InputEvent::Scroll { dx, dy } => format!("scroll dx={dx} dy={dy}"),
        InputEvent::Text(text) => format!("text {}", quoted(text)),
    }
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
}

fn capture_rect(state: &FakeState, target: &Target) -> BackendResult<(Rect, f64)> {
    match target {
        Target::Window(id) if state.exited.contains(id) => Err(Refusal::new(
            EngineCode::CaptureUnavailable,
            Reason::Unmapped.wire(),
        )),
        Target::Window(id) => {
            let window = state
                .live_window(id)
                .ok_or(Refusal::bare(EngineCode::WindowNotFound))?;
            Ok((
                window.bounds(),
                display_of(state, window).map_or(1.0, |d| d.scale),
            ))
        }
        Target::Display(id) => {
            let display = state
                .displays
                .iter()
                .find(|d| &d.id == id)
                .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
            Ok((display_info(display).bounds, display.scale))
        }
        Target::Desktop => {
            let display = state
                .displays
                .first()
                .ok_or(Refusal::bare(EngineCode::CaptureUnavailable))?;
            Ok((display_info(display).bounds, display.scale))
        }
    }
}

impl Backend for FakeBackend {
    fn capabilities(&self) -> Capabilities {
        let displays = self.lock().displays.len();
        self.with_scripted_session(fake_capabilities(self.persona, displays, self.stop_path))
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
}

#[cfg(test)]
mod extent_tests;
#[cfg(test)]
mod tests;
