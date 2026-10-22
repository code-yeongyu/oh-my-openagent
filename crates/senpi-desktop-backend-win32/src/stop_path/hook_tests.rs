//! The physical path end to end, without the system hook: the real hook
//! procedure, fed `KBDLLHOOKSTRUCT`s on an armed thread, must reach the
//! stop-commit worker and commit a stop; an injected chord must not.

use std::sync::Arc;
use std::time::Duration;

use senpi_desktop_safety::{Chord, MonotonicClock, StopSource, Supervisor};
use windows_sys::Win32::UI::WindowsAndMessaging::{HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, WM_KEYDOWN, WM_KEYUP};

use super::{arm, disarm, procedure};
use crate::stop_path::chord::{Hotkey, DEFAULT_STOP_CHORD};
use crate::stop_path::listener::{spawn_worker, Shared};

const VK_ESCAPE: u32 = 0x1B;
const VK_LCONTROL: u32 = 0xA2;
const VK_LMENU: u32 = 0xA4;
const VK_LSHIFT: u32 = 0xA0;
const HANG_GUARD: Duration = Duration::from_secs(10);

fn send(vk: u32, down: bool, injected: bool) {
    let info = KBDLLHOOKSTRUCT {
        vkCode: vk,
        scanCode: 0,
        flags: if injected { LLKHF_INJECTED } else { 0 },
        time: 0,
        dwExtraInfo: 0,
    };
    let message = if down { WM_KEYDOWN } else { WM_KEYUP };
    // SAFETY: [FFI] `procedure` reads `info` only during this call, as the
    // system would for HC_ACTION; the next-hook call ignores the null hook.
    unsafe { procedure(HC_ACTION as i32, message as usize, std::ptr::from_ref(&info) as isize) };
}

fn chord(injected: bool) {
    for vk in [VK_LCONTROL, VK_LMENU, VK_LSHIFT] {
        send(vk, true, injected);
    }
    send(VK_ESCAPE, true, injected);
    send(VK_ESCAPE, false, injected);
    for vk in [VK_LSHIFT, VK_LMENU, VK_LCONTROL] {
        send(vk, false, injected);
    }
}

fn armed() -> (Arc<Shared>, Arc<Supervisor>) {
    let supervisor = Arc::new(Supervisor::new(Arc::new(MonotonicClock::new())));
    let hotkey = Hotkey::parse(&Chord::parse(DEFAULT_STOP_CHORD).unwrap()).unwrap();
    let shared = Shared::new(Arc::clone(&supervisor), hotkey);
    spawn_worker(&shared).unwrap();
    arm(&shared, hotkey);
    (shared, supervisor)
}

#[test]
fn a_physical_chord_through_the_hook_procedure_commits_a_stop() {
    // Given: an armed thread and a running stop-commit worker
    let (shared, supervisor) = armed();

    // When: a person presses the chord
    chord(false);

    // Then: the worker committed the stop
    let mut control = shared.control.lock();
    let waited = shared.changed.wait_while_for(&mut control, |control| control.stops == 0, HANG_GUARD);
    let stops = control.stops;
    drop(control);
    disarm();
    shared.shut_down();
    assert!(!waited.timed_out(), "the worker never committed the stop");
    assert_eq!(stops, 1);
    assert!(supervisor.is_suspended());
    assert_eq!(supervisor.status().stopped_by, Some(StopSource::Hotkey));
}

#[test]
fn an_injected_chord_through_the_hook_procedure_never_stops() {
    // Given: an armed thread and a running stop-commit worker
    let (shared, supervisor) = armed();

    // When: a process injects the chord
    chord(true);

    // Then: the hook counted it as injected; nothing was suspended or committed
    let control = shared.control.lock();
    let (ignored, stops) = (control.injected_ignored, control.stops);
    drop(control);
    disarm();
    shared.shut_down();
    assert_eq!(ignored, 1);
    assert_eq!(stops, 0);
    assert!(!supervisor.is_suspended(), "suspend_input is synchronous, so its absence is final");
}
