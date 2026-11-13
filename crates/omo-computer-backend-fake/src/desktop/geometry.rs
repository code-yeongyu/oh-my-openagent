//! Scripted desktop geometry: display bounds, which display holds a window, and the rect a
//! capture target covers.

use omo_computer_core::backend::{BackendResult, Refusal, Target};
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::results::DisplayInfo;

use crate::scenario::{FakeDisplay, FakeWindow};
use crate::state::FakeState;

pub(super) fn display_info(display: &FakeDisplay) -> DisplayInfo {
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

pub(super) fn display_of<'a>(state: &'a FakeState, window: &FakeWindow) -> Option<&'a FakeDisplay> {
    state
        .displays
        .iter()
        .find(|display| contains(display, window.x, window.y))
        .or_else(|| state.displays.first())
}

pub(super) fn capture_rect(state: &FakeState, target: &Target) -> BackendResult<(Rect, f64)> {
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
