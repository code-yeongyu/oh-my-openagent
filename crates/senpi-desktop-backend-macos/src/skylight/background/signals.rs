//! HID switch sampling and out-of-band AX click placement.
//! Ported from oh-my-pi 0838d2ab44 (MIT, desktop/macos/skylight.rs).

use std::time::{Duration, Instant};

use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use parking_lot::Mutex;
use senpi_desktop_core::background_focus::SwitchSignals;

const BUTTON_EVENTS: [u32; 6] = [1, 2, 3, 4, 25, 26];
const PRESS_COUNTERS: [usize; 3] = [0, 2, 4];
const SWITCH_MODIFIERS: u64 = 0x0010_0000 | 0x0004_0000;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceCounterForEventType(state: i32, kind: u32) -> u32;
    fn CGEventSourceFlagsState(state: i32) -> u64;
    fn CGEventSourceSecondsSinceLastEventType(state: i32, kind: u32) -> f64;
}

fn buttons() -> [u32; 6] {
    BUTTON_EVENTS.map(|kind| {
        // SAFETY: HIDSystemState and all six event types are public constants.
        unsafe { CGEventSourceCounterForEventType(1, kind) }
    })
}

fn since_click() -> Option<Duration> {
    BUTTON_EVENTS
        .into_iter()
        .filter_map(|kind| {
            // SAFETY: Read-only HIDSystemState query using public event types.
            Duration::try_from_secs_f64(unsafe { CGEventSourceSecondsSinceLastEventType(1, kind) })
                .ok()
        })
        .min()
}

#[derive(Clone, Copy)]
struct Placement {
    buttons: [u32; 6],
    in_user_app: bool,
}

pub(super) struct ClickPlacer {
    user: libc::pid_t,
    latest: Mutex<Option<Placement>>,
}

impl ClickPlacer {
    pub(super) fn new(user: libc::pid_t) -> Self {
        Self {
            user,
            latest: Mutex::new(None),
        }
    }

    pub(super) fn place(&self) {
        let buttons = buttons();
        let latest = *self.latest.lock();
        if let Some(previous) = latest {
            if previous.buttons == buttons {
                return;
            }
            if PRESS_COUNTERS
                .iter()
                .all(|&i| previous.buttons[i] == buttons[i])
            {
                *self.latest.lock() = Some(Placement {
                    buttons,
                    ..previous
                });
                return;
            }
        }
        let in_user_app = since_click().is_some_and(|age| age <= Duration::from_millis(30))
            && pointer_owner() == Some(self.user);
        *self.latest.lock() = Some(Placement {
            buttons,
            in_user_app,
        });
    }
}

fn pointer_owner() -> Option<libc::pid_t> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).ok()?;
    let point = crate::input::probe_event(&source).ok()?.location();
    crate::ax::point_owner(point.x, point.y)
        .ok()
        .flatten()
        .map(|owner| owner.pid)
}

pub(super) fn read(
    now: Instant,
    placer: &ClickPlacer,
    last_send: Option<Instant>,
) -> SwitchSignals {
    let buttons = buttons();
    SwitchSignals {
        buttons,
        last_click: since_click().and_then(|age| now.checked_sub(age)),
        // SAFETY: Read-only HIDSystemState query.
        chord: unsafe { CGEventSourceFlagsState(1) } & SWITCH_MODIFIERS != 0,
        key_focus: super::restore::keyboard_focus_pid(),
        last_send,
        in_user_app: placer
            .latest
            .lock()
            .is_some_and(|placed| placed.buttons == buttons && placed.in_user_app),
    }
}
