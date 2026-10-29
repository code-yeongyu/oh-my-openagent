use std::ptr;
use std::time::Instant;

use libc::pid_t;
use senpi_desktop_core::key_reroute::audit::AuditLease;
use senpi_desktop_core::key_reroute::*;

use super::ffi::*;
use super::{keyboard_holders, REGISTRY};
use crate::input::ENGINE_EVENT_TAG;

/// Whether secure keyboard entry is on: a password field or a terminal with
/// secure keyboard entry has the keyboard.
pub(super) fn secure_entry() -> bool {
    // SAFETY: a read-only query of the system keyboard state.
    crate::stop_path::secure_input_enabled()
}

pub(super) fn mouse_buttons() -> [u32; 6] {
    // SAFETY: HIDSystemState and these CGEventType values are defined by
    // CGEventSource.h / CGEventTypes.h; read-only queries.
    MOUSE_BUTTON_EVENTS
        .map(|event_type| unsafe { CGEventSourceCounterForEventType(HID_SYSTEM_STATE, event_type) })
}

/// Whether the key with this virtual key code is down.
pub(super) fn key_down(code: i64) -> bool {
    // SAFETY: a read-only query of the system keyboard state.
    u16::try_from(code).is_ok_and(|code| unsafe { CGEventSourceKeyState(HID_SYSTEM_STATE, code) })
}

pub(super) struct TapContext {
    pub(super) theft: Theft,
    pub(super) chord: Chord,
    pub(super) focus_tap: Ref,
    pub(super) key_tap: Ref,
    pub(super) moved_events: u64,
    pub(super) audit: Option<AuditLease>,
}

impl TapContext {
    pub(super) fn signals(&self, now: Instant) -> UserSignals {
        let held_now = modifier_flags() & SWITCH_MODIFIERS != 0;
        UserSignals {
            buttons: mouse_buttons(),
            last_chord: self.chord.last(held_now, now),
        }
    }
}

pub(super) fn modifier_flags() -> u64 {
    // SAFETY: HIDSystemState is defined by CGEventSource.h; a read-only query.
    unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) }
}

pub(super) fn field(event: Ref, field: u32) -> i64 {
    // SAFETY: documented read-only CGEvent integer fields of a live event.
    unsafe { CGEventGetIntegerValueField(event, field) }
}

pub(super) fn pid_field(event: Ref, name: u32) -> pid_t {
    pid_t::try_from(field(event, name)).unwrap_or(-1)
}

pub(super) extern "C" fn observe_focus(
    _proxy: Ref,
    kind: u32,
    event: Ref,
    user: Ref,
) -> Ref {
    // SAFETY: the reroute thread keeps this context alive until both taps are
    // invalidated; both callbacks run on that thread's run loop.
    let context = unsafe { &mut *user.cast::<TapContext>() };
    if kind == TAP_DISABLED_BY_TIMEOUT || kind == TAP_DISABLED_BY_USER_INPUT {
        // SAFETY: the tap outlives its callbacks.
        unsafe { CGEventTapEnable(context.focus_tap, true) };
        // Notifications sent while the tap was off are lost: read who has the
        // keyboard now instead of waiting for the next one.
        if let Some((front, key_focus)) = keyboard_holders() {
            let now = Instant::now();
            let signals = context.signals(now);
            context.theft.resync(front, key_focus, signals, now);
            context.theft.publish(&mut REGISTRY.lock());
        }
        return event;
    }
    if event.is_null() {
        return event;
    }
    let now = Instant::now();
    if kind == FLAGS_CHANGED {
        if field(event, FIELD_SOURCE_PID) == 0 {
            // SAFETY: a read-only query of a live event.
            context
                .chord
                .flags_changed(unsafe { CGEventGetFlags(event) }, now);
        }
        return event;
    }
    if kind == PROCESS_NOTIFICATION {
        let signals = context.signals(now);
        context.theft.notify(
            field(event, FIELD_NOTIFICATION),
            pid_field(event, FIELD_RECIPIENT_PID),
            pid_field(event, FIELD_SUBJECT_PID),
            signals,
            now,
        );
        context.theft.publish(&mut REGISTRY.lock());
    }
    event
}

pub(super) extern "C" fn route_key(_proxy: Ref, kind: u32, event: Ref, user: Ref) -> Ref {
    // SAFETY: as in `observe_focus`.
    let context = unsafe { &mut *user.cast::<TapContext>() };
    if kind == TAP_DISABLED_BY_TIMEOUT || kind == TAP_DISABLED_BY_USER_INPUT {
        // SAFETY: the tap outlives its callbacks.
        unsafe { CGEventTapEnable(context.key_tap, true) };
        return event;
    }
    if event.is_null() || !matches!(kind, KEY_DOWN | KEY_UP | FLAGS_CHANGED) {
        return event;
    }
    let code = field(event, FIELD_KEYCODE);
    let stroke = match kind {
        KEY_DOWN if field(event, FIELD_AUTOREPEAT) != 0 => Some(Stroke::Repeat),
        KEY_DOWN => Some(Stroke::Press),
        KEY_UP => Some(Stroke::Release),
        // SAFETY: a read-only query of a live event.
        _ => Stroke::of_modifier(code, unsafe { CGEventGetFlags(event) }),
    };
    let source = (
        field(event, FIELD_SOURCE_PID),
        field(event, FIELD_SOURCE_USER_DATA),
    );
    let physical = typed_by_user(source.0, source.1, ENGINE_EVENT_TAG);
    // A key a process posted always passes, before the per-key system reads.
    if !physical {
        return event;
    }
    let key = Key {
        physical,
        code,
        stroke,
    };
    let secure = secure_entry();
    let buttons = mouse_buttons();
    let Some(to) = context
        .theft
        .route(&mut REGISTRY.lock(), key, secure, buttons)
    else {
        return event;
    };
    // SAFETY: the event is live for this callback; posting copies it to the
    // user's app, and returning null drops the original.
    unsafe { CGEventPostToPid(to, event.cast()) };
    context.moved_events += 1;
    if let Some(audit) = &mut context.audit {
        audit.moved_key();
    }
    ptr::null_mut()
}
