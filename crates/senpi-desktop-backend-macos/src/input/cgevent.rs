//! Shared CGEvent helpers: the never-suppressing combined-session event source,
//! modifier flags, button type tables, point clamping, and the click-group id.

use core_graphics::event::{CGEventFlags, CGEventType, CGMouseButton};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;
use core_graphics::sys::CGEventSourceRef;
use foreign_types::ForeignType;
use senpi_desktop_core::backend::{Modifiers, MouseButton};
use senpi_desktop_core::error::{CoreResult, DesktopError};

use std::time::{SystemTime, UNIX_EPOCH};

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

pub(super) fn point(x: f64, y: f64) -> CoreResult<CGPoint> {
    Ok(CGPoint::new(
        f64::from(finite_i32(x, "x coordinate")?),
        f64::from(finite_i32(y, "y coordinate")?),
    ))
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
