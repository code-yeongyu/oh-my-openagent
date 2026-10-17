//! Cursor primitives and the lock-screen probe.

use core_graphics::display::CGDisplay;
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation, CGEventType, CGMouseButton};
use core_graphics::event_source::CGEventSource;
use core_graphics::geometry::CGPoint;
use objc2_core_foundation::CFBoolean;
use objc2_core_graphics::CGSessionCopyCurrentDictionary;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopPoint;

/// The current global cursor position, read from a fresh `CGEventCreate`.
pub(crate) fn position(source: &CGEventSource) -> CoreResult<Option<DesktopPoint>> {
    let event = CGEvent::new(source.clone())
        .map_err(|()| DesktopError::input_failed("failed to create a Quartz probe event"))?;
    let location = event.location();
    Ok(Some(DesktopPoint {
        x: location.x,
        y: location.y,
    }))
}

/// Moves the cursor to a global logical point without clicking: the hardware
/// warp plus re-association, then one moved event so apps see the hover at the
/// new point (a bare warp leaves stale hover state behind).
pub(crate) fn warp(source: &CGEventSource, point: DesktopPoint) -> CoreResult<()> {
    let target = CGPoint::new(
        f64::from(finite(point.x, "x coordinate")?),
        f64::from(finite(point.y, "y coordinate")?),
    );
    CGDisplay::warp_mouse_cursor_position(target)
        .map_err(|error| DesktopError::input_failed(format!("cursor warp failed ({error:?})")))?;
    CGDisplay::associate_mouse_and_mouse_cursor_position(true)
        .map_err(|error| DesktopError::input_failed(format!("cursor re-association failed ({error:?})")))?;
    let event = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::MouseMoved,
        target,
        CGMouseButton::Left,
    )
    .map_err(|()| DesktopError::input_failed("failed to create a Quartz pointer event"))?;
    event.set_flags(CGEventFlags::CGEventFlagNull);
    event.post(CGEventTapLocation::HID);
    Ok(())
}

/// Whether the interactive session sits behind the lock screen; an unreadable
/// session dictionary counts as unlocked.
pub(crate) fn screen_locked() -> CoreResult<bool> {
    // The generated no-argument session query is itself unsafe and returns a
    // +1 dictionary or null.
    let session = CGSessionCopyCurrentDictionary();
    let Some(session) = session else {
        return Ok(false);
    };
    // SAFETY: The session dictionary is a CFDictionary<CFType, CFType>.
    let session = unsafe {
        objc2_core_foundation::CFRetained::cast_unchecked::<
            objc2_core_foundation::CFDictionary<objc2_core_foundation::CFType, objc2_core_foundation::CFType>,
        >(session)
    };
    let key = objc2_core_foundation::CFString::from_str("CGSSessionScreenIsLocked");
    Ok(session
        .get(&key)
        .and_then(|value| value.downcast::<CFBoolean>().ok())
        .is_some_and(|locked| locked.as_bool()))
}

fn finite(value: f64, name: &str) -> CoreResult<i32> {
    if !value.is_finite() || value < f64::from(i32::MIN) || value > f64::from(i32::MAX) {
        return Err(DesktopError::input_failed(format!(
            "{name} {value} is outside the macOS input range"
        )));
    }
    Ok(value.round() as i32)
}
