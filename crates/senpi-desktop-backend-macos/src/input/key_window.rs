//! Background keyboard delivery to one window of an application with one or
//! many windows: the window is made key behind the user's app, keys go out
//! only once accessibility shows they reach it, and every press checks that
//! again (ported from oh-my-pi 18.13.1 `macos/input.rs`
//! `with_background_keyboard`, `make_key_in_background`,
//! `activate_in_background`, `await_key_destination`; plan todo 9).

use std::thread;
use std::time::{Duration, Instant};

use core_graphics::event::{CGEventFlags, CGEventType, CGMouseButton};
use core_graphics::event_source::CGEventSource;
use core_graphics::geometry::CGPoint;
use foreign_types::ForeignType;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::intervention::check_press;
use senpi_desktop_core::types::DesktopWindow;

use super::cgevent::{blank_event, mouse_event};
use super::key_front::{front_refusal, front_target, recheck_background, EntryFront, FrontTarget};
use super::key_route::{
    attached_under, key_refusal, key_verdict, keyboard_conflict, keys_still_reach, unmapped_keyboard_refusal,
    KeyVerdict, KeyboardConflict,
};
use crate::ax::key_focus::{focused_window_id, key_focus, reports_active, window_records, KeyDestination, KeyFocus};
use crate::skylight::{front_pid, post_activation, sender_connection, set_fields, set_window_location, window_parent};

/// How long an application may take to report the key window asked for.
const KEY_WINDOW_TIMEOUT: Duration = Duration::from_millis(250);
const KEY_WINDOW_POLL: Duration = Duration::from_millis(10);
/// How long an application may take to report the activation posted to it.
const ACTIVE_STATE_TIMEOUT: Duration = Duration::from_millis(500);

const FIELD_MOUSE_EVENT_NUMBER: u32 = 0;
const FIELD_CLICK_STATE: u32 = 1;
const FIELD_PRESSURE: u32 = 2;
const FIELD_BUTTON_NUMBER: u32 = 3;
const FIELD_SUBTYPE: u32 = 7;
const FIELD_WINDOW_NUMBER: u32 = 51;
const FIELD_WINDOW_CONTEXT: u32 = 52;
const FIELD_APPKIT_SUBTYPE: u32 = 83;
const FIELD_WINDOW_UNDER_POINTER: u32 = 91;
const FIELD_WINDOW_UNDER_POINTER_THAT_CAN_HANDLE: u32 = 92;
const SUBTYPE_TOUCH: i64 = 3;
/// `NSEventTypeAppKitDefined`, which the `CGEventType` enum cannot express.
const APPKIT_DEFINED_EVENT: u32 = 13;
/// `NSEventSubtypeApplicationActivated`.
const APPLICATION_ACTIVATED: i64 = 1;
/// Flags `AppKit` stamps on a window's application-activated event.
const ACTIVATION_FLAGS: u64 = 0xc0000;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSetType(event: core_graphics::sys::CGEventRef, event_type: u32);
}

/// Window `wid` of `pid` proven to take background keys: the focus that
/// proved it, and whether it was made key behind the user's app.
pub(super) struct KeyWindow {
    pid: libc::pid_t,
    wid: u32,
    prepared: bool,
    proven: KeyFocus,
}

impl KeyWindow {
    /// Makes `wid` key behind the user's app and waits until accessibility
    /// shows keys would reach it; nothing reaches the target before that.
    /// Refuses when it is unmapped, a sheet attached to it holds focus, the
    /// user's own app would lose its typing, or another window stays key.
    /// `entry_front` was read as the input began.
    pub(super) fn prepare(
        source: &CGEventSource,
        window: &DesktopWindow,
        (pid, wid): (libc::pid_t, u32),
        entry_front: EntryFront,
    ) -> CoreResult<Self> {
        let conflict = conflict_now(pid, wid);
        if conflict == Some(KeyboardConflict::Unmapped) {
            return Err(unmapped_keyboard_refusal(wid));
        }
        let focus = key_focus(pid);
        let destination = focus.destination(wid, window_parent);
        if let KeyDestination::Other(Some(other)) = destination {
            if attached_under(other, window_parent, |parent| parent == wid) {
                return Err(key_refusal(wid, destination, conflict, window_parent));
            }
        }
        let in_overlay = focus.in_overlay_of(wid, window_parent);
        let prepared = make_key_in_background(source, window, (pid, wid), entry_front, in_overlay)?;
        let proven = await_key_destination(pid, wid, conflict)?;
        Ok(Self { pid, wid, prepared, proven })
    }

    /// The check before every background press: the user has not used the
    /// app since admission, keys still reach the window, and an app made key
    /// behind the user's is still behind it.
    pub(super) fn check(&self) -> CoreResult<()> {
        check_press()?;
        recheck_background(self.prepared, self.pid, self.wid, front_pid, || {
            keys_still_reach(self.wid, || conflict_now(self.pid, self.wid), self.proven, key_focus(self.pid), window_parent)
        })
    }
}

/// [`keyboard_conflict`] for window `wid` of `pid` as its accessibility
/// windows are now; nothing readable is unmapped.
fn conflict_now(pid: libc::pid_t, wid: u32) -> Option<KeyboardConflict> {
    window_records(pid).map_or(Some(KeyboardConflict::Unmapped), |records| {
        keyboard_conflict(wid, &records, || {
            focused_window_id(pid) == Some(wid)
                || attached_under(wid, window_parent, |parent| records.iter().any(|record| record.id == Some(parent)))
        })
    })
}

/// Makes `wid` key in its background application without activating it in
/// `WindowServer`: an `AppKit` application-activated event gives the app the
/// belief it is active (it drops pid-routed keys otherwise), and a press just
/// outside the window's frame makes exactly `wid` key without reaching its
/// controls. While focus sits in an overlay of `wid` the press is skipped,
/// since it would end that overlay's editing. In the front application
/// nothing is posted: the target already takes its keys, or making it key
/// would move the user's typing, which refuses. Returns whether the
/// activation ran.
fn make_key_in_background(
    source: &CGEventSource,
    window: &DesktopWindow,
    (pid, wid): (libc::pid_t, u32),
    entry_front: EntryFront,
    in_overlay: bool,
) -> CoreResult<bool> {
    let takes_keys = || in_overlay || key_focus(pid).destination(wid, window_parent) == KeyDestination::Target;
    match front_target(entry_front, front_pid(), pid, takes_keys) {
        FrontTarget::Background => {}
        FrontTarget::Key => return Ok(false),
        refused => return Err(front_refusal(refused, wid)),
    }
    let context = sender_connection()?;
    activate_in_background(source, pid, wid, context)?;
    recheck_background(true, pid, wid, front_pid, || Ok(()))?;
    if in_overlay {
        return Ok(true);
    }
    let local = CGPoint::new(-1.0, -1.0);
    let location = CGPoint::new(f64::from(window.x) + local.x, f64::from(window.y) + local.y);
    let press = |event_type: CGEventType, number: i64| -> CoreResult<()> {
        let event = mouse_event(source, event_type, location, CGMouseButton::Left)?;
        set_fields(
            &event,
            &[
                (FIELD_MOUSE_EVENT_NUMBER, number),
                (FIELD_CLICK_STATE, 1),
                (FIELD_PRESSURE, 255),
                (FIELD_BUTTON_NUMBER, 0),
                (FIELD_SUBTYPE, SUBTYPE_TOUCH),
                (FIELD_WINDOW_NUMBER, i64::from(wid)),
                (FIELD_WINDOW_CONTEXT, context),
                (FIELD_WINDOW_UNDER_POINTER, i64::from(wid)),
                (FIELD_WINDOW_UNDER_POINTER_THAT_CAN_HANDLE, i64::from(wid)),
            ],
        )?;
        set_window_location(&event, local)?;
        post_activation(pid, &event)
    };
    let pressed = press(CGEventType::LeftMouseDown, 1);
    let released = press(CGEventType::LeftMouseUp, 2);
    pressed.and(released).map(|()| true)
}

/// Tells background process `pid` it is active with window `wid` key, as
/// `AppKit` does for a real activation, and gives it until
/// [`ACTIVE_STATE_TIMEOUT`] to report it ([`activate_then_await`]).
fn activate_in_background(source: &CGEventSource, pid: libc::pid_t, wid: u32, context: i64) -> CoreResult<()> {
    let activate = || -> CoreResult<()> {
        let event = blank_event(source)?;
        // SAFETY: `event` is a live CGEvent and the type is a valid CGEventType
        // value the core-graphics enum lacks.
        unsafe { CGEventSetType(event.as_ptr(), APPKIT_DEFINED_EVENT) };
        event.set_flags(CGEventFlags::from_bits_retain(ACTIVATION_FLAGS));
        set_fields(
            &event,
            &[
                (FIELD_WINDOW_NUMBER, i64::from(wid)),
                (FIELD_WINDOW_CONTEXT, context),
                (FIELD_APPKIT_SUBTYPE, APPLICATION_ACTIVATED),
            ],
        )?;
        post_activation(pid, &event)
    };
    activate_then_await(reports_active(pid), ACTIVE_STATE_TIMEOUT, activate, || reports_active(pid))
}

/// Posts the activation through `activate` and, when the application reported
/// itself inactive before (`was_active`), waits until `reports_active` shows
/// it active: an edit made through accessibility is recorded by the app's
/// run loop turn the activation starts, and a shortcut queued behind it would
/// otherwise run first. A report that does not come within `timeout` is not
/// an error; delivery then goes ahead as it would without the wait.
fn activate_then_await(
    was_active: Option<bool>,
    timeout: Duration,
    activate: impl FnOnce() -> CoreResult<()>,
    mut reports_active: impl FnMut() -> Option<bool>,
) -> CoreResult<()> {
    activate()?;
    if was_active != Some(false) {
        return Ok(());
    }
    let deadline = Instant::now() + timeout;
    while reports_active() != Some(true) && Instant::now() < deadline {
        thread::sleep(KEY_WINDOW_POLL);
    }
    Ok(())
}

/// Waits until keys posted now would reach `wid`, which the application
/// establishes asynchronously, and returns the focus that proved it.
fn await_key_destination(pid: libc::pid_t, wid: u32, conflict: Option<KeyboardConflict>) -> CoreResult<KeyFocus> {
    let deadline = Instant::now() + KEY_WINDOW_TIMEOUT;
    loop {
        let focus = key_focus(pid);
        let destination = focus.destination(wid, window_parent);
        if key_verdict(destination, conflict) == KeyVerdict::Deliver {
            return Ok(focus);
        }
        if Instant::now() >= deadline {
            return Err(key_refusal(wid, destination, conflict, window_parent));
        }
        thread::sleep(KEY_WINDOW_POLL);
    }
}
