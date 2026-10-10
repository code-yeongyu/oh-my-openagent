//! `XSendEvent` pointer delivery to one background window: the events carry
//! root and window-local coordinates and the modifier/button state, and
//! neither the pointer nor the focus moves.

use std::thread;

use senpi_desktop_core::backend::PointerEvent;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use x11rb::protocol::xproto::{KeyButMask, Window};

use super::held::{HeldButton, Route};
use super::keys::modifiers_mask;
use super::server::{InputServer, SentEvent, Spot};
use super::xtest::{button_detail, point, scroll_buttons, CLICK_DELAY, DRAG_STEP_DELAY};
use super::X11Input;

impl<S: InputServer> X11Input<S> {
    /// `top` is the requested top-level window; each event goes to its
    /// deepest mapped descendant under the event's first point (a drag keeps
    /// the window its press landed in, as a real grab would).
    pub(super) fn pointer_send_event(&mut self, top: Window, event: &PointerEvent) -> CoreResult<()> {
        let (x, y) = first_point(event)?;
        let (root_x, root_y) = point(x, y)?;
        let window = self.server.target_at(top, root_x, root_y)?;
        let route = Route::Window(window);
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                let detail = button_detail(*button);
                let down = HeldButton {
                    route,
                    detail,
                    at: self.spot(window, *x, *y)?,
                };
                let state = modifiers_mask(*modifiers);
                for _ in 0..(*count).max(1) {
                    self.button(down, true, state)?;
                    thread::sleep(CLICK_DELAY);
                    self.button(down, false, state | button_mask(detail))?;
                    thread::sleep(CLICK_DELAY);
                }
            }
            PointerEvent::Move { x, y } => {
                let at = self.spot(window, *x, *y)?;
                self.server.send(window, SentEvent::Motion { at, state: 0 })?;
            }
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                let spots = path
                    .iter()
                    .map(|&(x, y)| self.spot(window, x, y))
                    .collect::<CoreResult<Vec<_>>>()?;
                let (Some(&first), Some(&last)) = (spots.first(), spots.last()) else {
                    return Err(DesktopError::input_failed("drag path is empty"));
                };
                let detail = button_detail(*button);
                let base = modifiers_mask(*modifiers);
                let state = base | button_mask(detail);
                self.button(
                    HeldButton {
                        route,
                        detail,
                        at: first,
                    },
                    true,
                    base,
                )?;
                let moved = spots.iter().skip(1).try_for_each(|&at| {
                    thread::sleep(DRAG_STEP_DELAY);
                    self.server.send(window, SentEvent::Motion { at, state })
                });
                let released = self.button(
                    HeldButton {
                        route,
                        detail,
                        at: last,
                    },
                    false,
                    state,
                );
                moved.and(released)?;
            }
            PointerEvent::Scroll { x, y, dx, dy } => {
                let at = self.spot(window, *x, *y)?;
                for (detail, clicks) in scroll_buttons(*dx, *dy) {
                    let wheel = HeldButton { route, detail, at };
                    for _ in 0..clicks {
                        self.button(wheel, true, 0)?;
                        self.button(wheel, false, 0)?;
                    }
                }
            }
        }
        self.server.flush()
    }

    /// Root `(x, y)` and the same point in `window`.
    fn spot(&self, window: Window, x: f64, y: f64) -> CoreResult<Spot> {
        let root = point(x, y)?;
        let local = self.server.translate(window, root.0, root.1)?;
        Ok(Spot { root, local })
    }
}

/// The root point that picks the event window.
fn first_point(event: &PointerEvent) -> CoreResult<(f64, f64)> {
    match event {
        PointerEvent::Click { x, y, .. }
        | PointerEvent::Move { x, y }
        | PointerEvent::Scroll { x, y, .. } => Ok((*x, *y)),
        PointerEvent::Drag { path, .. } => path
            .first()
            .copied()
            .ok_or_else(|| DesktopError::input_failed("drag path is empty")),
    }
}

/// The `state` bit of a held pointer button, carried by its release.
fn button_mask(detail: u8) -> u16 {
    let mask = match detail {
        1 => KeyButMask::BUTTON1,
        2 => KeyButMask::BUTTON2,
        3 => KeyButMask::BUTTON3,
        _ => return 0,
    };
    u16::from(mask)
}

pub const fn event_kind(event: &PointerEvent) -> &'static str {
    match event {
        PointerEvent::Click { .. } => "click",
        PointerEvent::Move { .. } => "move",
        PointerEvent::Drag { .. } => "drag",
        PointerEvent::Scroll { .. } => "scroll",
    }
}
