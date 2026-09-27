//! Global (whole-desktop) pointer delivery through the HID event tap. This is
//! the only path allowed to call `CGEventPost(kCGHIDEventTap)`.

use std::thread;
use std::time::Duration;

use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton, EventField, ScrollEventUnit,
};
use core_graphics::event_source::CGEventSource;
use core_graphics::geometry::CGPoint;
use senpi_desktop_core::backend::PointerEvent;
use senpi_desktop_core::error::{CoreResult, DesktopError};

use super::cgevent::{button_types, click_group_id, finite_i32, modifier_flags, point};
use super::held::{ButtonRoute, Held, HeldButton};

pub(super) fn pointer(source: &CGEventSource, held: &mut Held, event: PointerEvent) -> CoreResult<()> {
    match event {
        PointerEvent::Click {
            x,
            y,
            button,
            count,
            modifiers,
        } => {
            post_global_mouse(
                source,
                CGEventType::MouseMoved,
                CGMouseButton::Left,
                x,
                y,
                0,
                0,
                CGEventFlags::CGEventFlagNull,
            )?;
            let (cg_button, down, up, _, number) = button_types(button);
            let flags = modifier_flags(modifiers);
            let route = ButtonRoute::Global(point(x, y)?);
            for click_state in 1..=count.max(1) {
                held.button_down(HeldButton { route, button });
                post_global_mouse(
                    source,
                    down,
                    cg_button,
                    x,
                    y,
                    i64::from(click_state),
                    number,
                    flags,
                )?;
                thread::sleep(Duration::from_millis(1));
                post_global_mouse(source, up, cg_button, x, y, i64::from(click_state), number, flags)?;
                held.button_up(&route, button);
                if click_state < count.max(1) {
                    thread::sleep(Duration::from_millis(80));
                }
            }
            Ok(())
        }
        PointerEvent::Move { x, y } => post_global_mouse(
            source,
            CGEventType::MouseMoved,
            CGMouseButton::Left,
            x,
            y,
            0,
            0,
            CGEventFlags::CGEventFlagNull,
        ),
        PointerEvent::Drag {
            path,
            button,
            modifiers,
        } => {
            let Some(&(start_x, start_y)) = path.first() else {
                return Err(DesktopError::input_failed(
                    "drag path must contain at least two points",
                ));
            };
            if path.len() < 2 {
                return Err(DesktopError::input_failed(
                    "drag path must contain at least two points",
                ));
            }
            let (cg_button, down, up, dragged, number) = button_types(button);
            let flags = modifier_flags(modifiers);
            post_global_mouse(
                source,
                CGEventType::MouseMoved,
                CGMouseButton::Left,
                start_x,
                start_y,
                0,
                0,
                CGEventFlags::CGEventFlagNull,
            )?;
            let route = ButtonRoute::Global(point(start_x, start_y)?);
            held.button_down(HeldButton { route, button });
            post_global_mouse(source, down, cg_button, start_x, start_y, 1, number, flags)?;
            for &(x, y) in &path[1..] {
                thread::sleep(Duration::from_millis(16));
                post_global_mouse(source, dragged, cg_button, x, y, 1, number, flags)?;
            }
            thread::sleep(Duration::from_millis(50));
            let &(end_x, end_y) = path
                .last()
                .ok_or_else(|| DesktopError::input_failed("drag path is empty"))?;
            let result = post_global_mouse(source, up, cg_button, end_x, end_y, 1, number, flags);
            if result.is_ok() {
                held.button_up(&route, button);
            }
            result
        }
        PointerEvent::Scroll { x, y, dx, dy } => {
            post_global_mouse(
                source,
                CGEventType::MouseMoved,
                CGMouseButton::Left,
                x,
                y,
                0,
                0,
                CGEventFlags::CGEventFlagNull,
            )?;
            let wheel_x = finite_i32(dx, "horizontal scroll delta")?;
            let wheel_y = finite_i32(dy, "vertical scroll delta")?;
            let event =
                CGEvent::new_scroll_event(source.clone(), ScrollEventUnit::PIXEL, 2, wheel_y, wheel_x, 0)
                    .map_err(|()| DesktopError::input_failed("failed to create a Quartz scroll event"))?;
            event.set_location(point(x, y)?);
            post_global(&event)
        }
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the parameters are the native CGEvent fields posted together"
)]
fn post_global_mouse(
    source: &CGEventSource,
    event_type: CGEventType,
    button: CGMouseButton,
    x: f64,
    y: f64,
    click_state: i64,
    button_number: i64,
    flags: CGEventFlags,
) -> CoreResult<()> {
    let location = point(x, y)?;
    let event = CGEvent::new_mouse_event(source.clone(), event_type, location, button)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz pointer event"))?;
    event.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, click_state);
    if button_number != 0 {
        event.set_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER, button_number);
    }
    event.set_flags(flags);
    post_global(&event)
}

/// Posts the mouse-up for a still-held button through the route it was pressed
/// on: the HID tap for global presses, the stamped SkyLight post for window
/// presses. The safety release must replay the original route.
pub(super) fn release_button(source: &CGEventSource, held: &super::held::HeldButton) -> CoreResult<()> {
    let (cg_button, _, up, _, number) = button_types(held.button);
    match held.route {
        ButtonRoute::Global(at) => post_global_mouse(
            source,
            up,
            cg_button,
            at.x,
            at.y,
            1,
            number,
            CGEventFlags::CGEventFlagNull,
        ),
        ButtonRoute::Window(pid, wid, local) => {
            let event =
                CGEvent::new_mouse_event(source.clone(), up, CGPoint::new(local.x, local.y), cg_button)
                    .map_err(|()| DesktopError::input_failed("failed to create a Quartz pointer event"))?;
            event.set_flags(CGEventFlags::CGEventFlagNull);
            crate::skylight::stamp_event(&event, pid, wid, local, 3, 1, number, click_group_id())?;
            crate::skylight::post_dual(pid, &event)
        }
    }
}

fn post_global(event: &CGEvent) -> CoreResult<()> {
    event.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(test)]
mod tests {
    /// The one HID tap call site is `post_global`; the count includes this
    /// assertion's own literal, hence the pinned total of 2.
    #[test]
    fn the_global_path_is_the_only_hid_tap_caller() {
        let source = include_str!("global.rs");
        assert_eq!(source.matches("CGEventTapLocation::HID").count(), 2);
        assert!(!include_str!("background.rs").contains("CGEventTapLocation"));
        assert!(!include_str!("guard.rs").contains("CGEventTapLocation"));
        assert!(!include_str!("canary.rs").contains("CGEventTapLocation"));
        assert!(!include_str!("../focus.rs").contains("CGEventTapLocation"));
    }
}
