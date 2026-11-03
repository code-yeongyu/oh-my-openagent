//! Shared CGEvent helpers: the never-suppressing combined-session event source,
//! the tagged event constructors every engine event comes from, modifier
//! flags, button type tables, point clamping, and the click-group id.

use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventType, CGMouseButton, EventField, ScrollEventUnit,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;
use core_graphics::sys::CGEventSourceRef;
use foreign_types::ForeignType;
use senpi_desktop_core::backend::{Modifiers, MouseButton};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use std::time::{SystemTime, UNIX_EPOCH};

/// `kCGEventSourceUserData` (field 42) on every event the engine creates, so
/// the user-input watch tells the engine's own input from the user's even
/// when another process relays it (D3). ASCII `senpidsk`.
pub(crate) const ENGINE_EVENT_TAG: i64 = i64::from_be_bytes(*b"senpidsk");

// Hardware input carries 0 in this field: the tag must differ from it.
const _: () = assert!(ENGINE_EVENT_TAG != 0);

fn tagged(event: CGEvent) -> CGEvent {
    event.set_integer_value_field(EventField::EVENT_SOURCE_USER_DATA, ENGINE_EVENT_TAG);
    event
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventCreateKeyboardEvent(source: CGEventSourceRef, code: u16, down: bool) -> *mut core_graphics::sys::CGEvent;
}

/// A bare key transition for a remote screen: a NULL event source and no
/// flag override, so CoreGraphics derives the modifier state from the
/// transitions exactly as for a hardware keyboard. It still carries the
/// engine tag: with a null source the event's source pid is 0, and the
/// user-input watch (D3) tells the engine's events apart by the tag.
pub(crate) fn bare_keyboard_event(code: u16, down: bool) -> CoreResult<CGEvent> {
    // SAFETY: [FFI] a NULL source is documented as valid for keyboard events;
    // the returned create-rule event's ownership moves into `CGEvent`.
    let raw = unsafe { CGEventCreateKeyboardEvent(std::ptr::null_mut(), code, down) };
    if raw.is_null() {
        return Err(DesktopError::input_failed("failed to create a Quartz keyboard event"));
    }
    // SAFETY: [FFI] `raw` is a non-null create-rule event owned here.
    Ok(tagged(unsafe { CGEvent::from_ptr(raw) }))
}

pub(crate) fn keyboard_event(source: &CGEventSource, code: u16, down: bool) -> CoreResult<CGEvent> {
    CGEvent::new_keyboard_event(source.clone(), code, down)
        .map(tagged)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz keyboard event"))
}

pub(crate) fn mouse_event(
    source: &CGEventSource,
    event_type: CGEventType,
    location: CGPoint,
    button: CGMouseButton,
) -> CoreResult<CGEvent> {
    CGEvent::new_mouse_event(source.clone(), event_type, location, button)
        .map(tagged)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz pointer event"))
}

/// A pixel scroll of the vertical and horizontal wheels.
pub(crate) fn scroll_event(
    source: &CGEventSource,
    wheel_y: i32,
    wheel_x: i32,
) -> CoreResult<CGEvent> {
    CGEvent::new_scroll_event(
        source.clone(),
        ScrollEventUnit::PIXEL,
        2,
        wheel_y,
        wheel_x,
        0,
    )
    .map(tagged)
    .map_err(|()| DesktopError::input_failed("failed to create a Quartz scroll event"))
}

/// An event that is read, never posted (the cursor-position probe).
pub(crate) fn probe_event(source: &CGEventSource) -> CoreResult<CGEvent> {
    CGEvent::new(source.clone())
        .map(tagged)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz probe event"))
}

pub(crate) fn modifier_flags(modifiers: Modifiers) -> CGEventFlags {
    let mut flags = CGEventFlags::CGEventFlagNull;
    if modifiers.ctrl {
        flags |= CGEventFlags::CGEventFlagControl;
    }
    if modifiers.alt {
        flags |= CGEventFlags::CGEventFlagAlternate;
    }
    if modifiers.shift {
        flags |= CGEventFlags::CGEventFlagShift;
    }
    if modifiers.meta {
        flags |= CGEventFlags::CGEventFlagCommand;
    }
    flags
}

/// The CG types of one mouse button: its identity, down/up/dragged events,
/// and the `kCGMouseEventButtonNumber` field value.
pub(super) const fn button_types(
    button: MouseButton,
) -> (CGMouseButton, CGEventType, CGEventType, CGEventType, i64) {
    match button {
        MouseButton::Left => (
            CGMouseButton::Left,
            CGEventType::LeftMouseDown,
            CGEventType::LeftMouseUp,
            CGEventType::LeftMouseDragged,
            0,
        ),
        MouseButton::Right => (
            CGMouseButton::Right,
            CGEventType::RightMouseDown,
            CGEventType::RightMouseUp,
            CGEventType::RightMouseDragged,
            1,
        ),
        MouseButton::Middle => (
            CGMouseButton::Center,
            CGEventType::OtherMouseDown,
            CGEventType::OtherMouseUp,
            CGEventType::OtherMouseDragged,
            2,
        ),
    }
}

/// Whether a pointer event presses or moves, so the user-intervention check
/// runs before it. A button release or a drag step always follows the press it
/// belongs to, so a refusal never leaves a button down.
pub(super) const fn is_press(event_type: CGEventType) -> bool {
    matches!(
        event_type,
        CGEventType::LeftMouseDown
            | CGEventType::RightMouseDown
            | CGEventType::OtherMouseDown
            | CGEventType::MouseMoved
    )
}

pub(super) fn point(x: f64, y: f64) -> CoreResult<CGPoint> {
    Ok(CGPoint::new(
        f64::from(finite_i32(x, "x coordinate")?),
        f64::from(finite_i32(y, "y coordinate")?),
    ))
}

/// Quartz wheel deltas `(wheel1, wheel2)` for a scroll of `(dx, dy)`. The engine's
/// convention on every platform is positive `dy` scrolls down and positive `dx`
/// scrolls right (X11 buttons 5/7, Windows `WM_MOUSEWHEEL`/`WM_MOUSEHWHEEL`);
/// Quartz counts a positive vertical wheel as up and a positive horizontal wheel
/// as left, so both are negated. Synthetic wheel events are not inverted by the
/// natural-scrolling setting (`com.apple.swipescrolldirection`): the same deltas
/// moved a TextEdit view the same way with the setting on and off (#9055).
pub(super) fn quartz_wheel(dx: f64, dy: f64) -> CoreResult<(i32, i32)> {
    let vertical = finite_i32(dy, "vertical scroll delta")?;
    let horizontal = finite_i32(dx, "horizontal scroll delta")?;
    Ok((vertical.saturating_neg(), horizontal.saturating_neg()))
}

pub(super) fn finite_i32(value: f64, name: &str) -> CoreResult<i32> {
    if !value.is_finite() || value < f64::from(i32::MIN) || value > f64::from(i32::MAX) {
        return Err(DesktopError::input_failed(format!(
            "{name} {value} is outside the macOS input range"
        )));
    }
    Ok(value.round() as i32)
}

/// A per-gesture id: events of one click/drag share the group so apps see a
/// coherent gesture.
pub(super) const LOCAL_EVENT_FILTER: u32 = 0x01 | 0x02 | 0x04;
pub(super) const SUPPRESSION_INTERVAL: u32 = 0;
pub(super) const REMOTE_MOUSE_DRAG: u32 = 1;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    #[link_name = "CGEventSourceSetLocalEventsSuppressionInterval"]
    fn set_local_events_suppression_interval(source: CGEventSourceRef, seconds: f64);
    #[link_name = "CGEventSourceSetLocalEventsFilterDuringSuppressionState"]
    fn set_local_events_filter_during_suppression_state(source: CGEventSourceRef, filter: u32, state: u32);
    #[cfg(test)]
    #[link_name = "CGEventSourceGetLocalEventsSuppressionInterval"]
    pub(super) fn get_local_events_suppression_interval(source: CGEventSourceRef) -> f64;
    #[cfg(test)]
    #[link_name = "CGEventSourceGetLocalEventsFilterDuringSuppressionState"]
    pub(super) fn get_local_events_filter_during_suppression_state(
        source: CGEventSourceRef,
        state: u32,
    ) -> u32;
}

/// The combined-session event source whose local-event suppression is disabled:
/// the user's own typing is never swallowed by our posts.
pub(super) fn event_source() -> CoreResult<CGEventSource> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz input event source"))?;
    // SAFETY: `source` is a live CGEventSource and both setters accept these
    // documented masks/states. Zero suppression interval: the user's own
    // typing is never swallowed by our posts.
    unsafe {
        set_local_events_suppression_interval(source.as_ptr(), 0.0);
        set_local_events_filter_during_suppression_state(
            source.as_ptr(),
            LOCAL_EVENT_FILTER,
            SUPPRESSION_INTERVAL,
        );
        set_local_events_filter_during_suppression_state(
            source.as_ptr(),
            LOCAL_EVENT_FILTER,
            REMOTE_MOUSE_DRAG,
        );
    }
    Ok(source)
}

pub(super) fn click_group_id() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positive_dy_scrolls_down_and_positive_dx_scrolls_right_in_quartz_terms() {
        // Quartz: a negative vertical wheel scrolls down, a negative horizontal wheel scrolls right.
        assert_eq!(quartz_wheel(0.0, 300.0).unwrap(), (-300, 0));
        assert_eq!(quartz_wheel(0.0, -300.0).unwrap(), (300, 0));
        assert_eq!(quartz_wheel(40.0, 0.0).unwrap(), (0, -40));
        assert_eq!(quartz_wheel(-40.0, 0.0).unwrap(), (0, 40));
        assert!(quartz_wheel(f64::NAN, 1.0).is_err());
    }

    #[test]
    fn every_event_the_engine_creates_carries_its_tag() {
        let source = event_source().expect("Quartz event source");
        let events = [
            keyboard_event(&source, 0, true).expect("keyboard event"),
            mouse_event(
                &source,
                CGEventType::LeftMouseDown,
                CGPoint::new(1.0, 1.0),
                CGMouseButton::Left,
            )
            .expect("pointer event"),
            scroll_event(&source, -3, 0).expect("scroll event"),
            probe_event(&source).expect("probe event"),
        ];
        for event in events {
            assert_eq!(
                event.get_integer_value_field(EventField::EVENT_SOURCE_USER_DATA),
                ENGINE_EVENT_TAG
            );
        }
    }

    #[test]
    fn flags_map_each_modifier() {
        let none = modifier_flags(Modifiers::default());
        let all = modifier_flags(Modifiers {
            ctrl: true,
            alt: true,
            shift: true,
            meta: true,
        });
        assert!(none.is_empty());
        assert!(all.contains(CGEventFlags::CGEventFlagControl));
        assert!(all.contains(CGEventFlags::CGEventFlagAlternate));
        assert!(all.contains(CGEventFlags::CGEventFlagShift));
        assert!(all.contains(CGEventFlags::CGEventFlagCommand));
    }

    #[test]
    fn non_finite_coordinates_are_rejected() {
        assert!(finite_i32(f64::NAN, "x").is_err());
        assert!(finite_i32(1e12, "x").is_err());
        assert_eq!(finite_i32(3.6, "x"), Ok(4));
    }

    #[test]
    fn only_presses_and_moves_run_the_press_check() {
        for button in [MouseButton::Left, MouseButton::Right, MouseButton::Middle] {
            let (_, down, up, dragged, _) = button_types(button);
            assert!(is_press(down));
            assert!(!is_press(up));
            assert!(!is_press(dragged));
        }
        assert!(is_press(CGEventType::MouseMoved));
    }

    #[test]
    fn button_tables_carry_distinct_button_numbers() {
        let (_, left_down, _, _, left_number) = button_types(MouseButton::Left);
        let (_, right_down, _, _, right_number) = button_types(MouseButton::Right);
        let (_, middle_down, _, _, middle_number) = button_types(MouseButton::Middle);
        assert_ne!(left_down as u32, right_down as u32);
        assert_ne!(left_down as u32, middle_down as u32);
        assert_eq!(left_number, 0);
        assert_eq!(right_number, 1);
        assert_eq!(middle_number, 2);
    }
}
