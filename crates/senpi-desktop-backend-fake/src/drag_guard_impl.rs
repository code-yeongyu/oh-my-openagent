//! The fake's drag-and-drop guard (scenario `drag_guard`): the start-point
//! role comes from the scripted accessibility tree, and a window listed in
//! `drag_picks_up` begins a session as the first dragged event lands, so the
//! recorded stroke goes back to its start and the call fails as macOS does.

use std::cell::Cell;

use senpi_desktop_core::backend::{DeliveryMode, MouseButton, PointerEvent};
use senpi_desktop_core::drag_guard::{
    picked_up_refusal, refuse_drag_source, stroke_path, LeftPress, StartPoint, Stroke,
};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::holds::MouseHold;
use senpi_desktop_core::types::Target;

use crate::fake::FakeBackend;

/// What the guard let through: the drag to record, or a drag the source
/// picked up, whose shortened stroke is recorded before the call fails.
pub(crate) enum Guarded {
    Deliver(PointerEvent),
    PickedUp {
        recorded: PointerEvent,
        error: DesktopError,
    },
}

impl FakeBackend {
    /// The drag to record: unchanged when the guard is off or the gesture is
    /// not a background left drag of a window; refused on a start point that
    /// does not track drags; cut back to its start when the window picks up.
    pub(crate) fn guard_drag(
        &self,
        target: &Target,
        ev: PointerEvent,
        mode: DeliveryMode,
    ) -> CoreResult<Guarded> {
        let (Target::Window(id), DeliveryMode::Background, true) = (target, mode, self.drag_guard)
        else {
            return Ok(Guarded::Deliver(ev));
        };
        let PointerEvent::Drag {
            path,
            button: MouseButton::Left,
            modifiers,
        } = ev
        else {
            return Ok(Guarded::Deliver(ev));
        };
        let window = self.window(id)?;
        let Some(&start) = path.first() else {
            return Ok(Guarded::Deliver(PointerEvent::Drag {
                path,
                button: MouseButton::Left,
                modifiers,
            }));
        };
        let press = LeftPress {
            kind: "drag",
            window,
            start,
        };
        refuse_drag_source(press, |x, y| self.start_point(id, x, y))?;
        let picks_up = self.drag_picks_up.iter().any(|picked| picked == id);
        let dragged = Cell::new(0usize);
        let mut recorded = Vec::with_capacity(path.len());
        let session = stroke_path(
            &path,
            || picks_up && dragged.get() > 0,
            |stroke, at| {
                if stroke == Stroke::Dragged {
                    dragged.set(dragged.get() + 1);
                }
                if stroke != Stroke::Up || recorded.last() != Some(&at) {
                    recorded.push(at);
                }
                Ok(())
            },
        )?;
        let drag = PointerEvent::Drag {
            path: recorded,
            button: MouseButton::Left,
            modifiers,
        };
        Ok(if session {
            Guarded::PickedUp {
                recorded: drag,
                error: picked_up_refusal(window),
            }
        } else {
            Guarded::Deliver(drag)
        })
    }

    pub(crate) fn guard_hold(
        &self,
        target: &Target,
        hold: &MouseHold<'_>,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        let (Target::Window(id), DeliveryMode::Background, true, MouseButton::Left) =
            (target, mode, self.drag_guard, hold.button)
        else {
            return Ok(());
        };
        let press = LeftPress {
            kind: "mouse hold",
            window: self.window(id)?,
            start: (hold.x, hold.y),
        };
        refuse_drag_source(press, |x, y| self.start_point(id, x, y))
    }

    /// The scripted element under the point, as the application-wide
    /// hit-test finds it: one scripted for another window covers the target.
    fn start_point(&self, window_id: &str, x: f64, y: f64) -> StartPoint {
        let Some(node) = self.ax_tree.element_at(x, y) else {
            return StartPoint::Unread;
        };
        match self.ax_tree.window_of(node) {
            Ok(Some(owner)) if owner == window_id => self
                .ax_tree
                .props(node)
                .map_or(StartPoint::Unread, |props| {
                    StartPoint::Role(props.native_role)
                }),
            Ok(Some(_)) => StartPoint::Covered,
            _ => StartPoint::Unread,
        }
    }
}
