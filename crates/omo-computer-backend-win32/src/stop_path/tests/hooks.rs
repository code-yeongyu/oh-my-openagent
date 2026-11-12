//! The low-level hooks (d-windows.md '## Capture guard and input lock').

use crate::input::ledger::{replay, Entry, Ledger, Step};
use crate::input::{KeyUnit, ENGINE_TAG, VK_CONTROL, VK_MENU, VK_SHIFT};
use crate::input_lock::{lock_verdict, LockVerdict};
use crate::stop_path::{HookEvent, HotkeyVerdict, Origin, PhysicalChord, Sightings, VK_ESCAPE};

fn key(vk: u16, down: bool, origin: Origin, time: u64) -> HookEvent {
    let (injected, extra) = match origin {
        Origin::Physical => (false, 0),
        Origin::Ours => (true, ENGINE_TAG),
        Origin::Foreign => (true, 0),
    };
    HookEvent {
        vk,
        down,
        injected,
        extra_info: extra,
        time,
    }
}

fn chord(tracker: &mut PhysicalChord, origin: Origin, time: u64) -> bool {
    let mut stopped = false;
    for vk in [VK_CONTROL, VK_MENU, VK_SHIFT, VK_ESCAPE] {
        stopped |= tracker
            .on_key(&key(vk, true, origin, time))
            .is_some_and(|s| s == Origin::Physical);
    }
    for vk in [VK_ESCAPE, VK_SHIFT, VK_MENU, VK_CONTROL] {
        tracker.on_key(&key(vk, false, origin, time));
    }
    stopped
}

#[test]
fn injected_chord_never_latches_the_stop() {
    let mut tracker = PhysicalChord::default();
    assert!(
        !chord(&mut tracker, Origin::Foreign, 10),
        "another injector's chord never stops"
    );
    assert!(
        !chord(&mut tracker, Origin::Ours, 20),
        "our own tagged chord never stops"
    );
    assert!(
        tracker.held().is_empty(),
        "injected keys are never 'physically held'"
    );
    assert!(
        chord(&mut tracker, Origin::Physical, 30),
        "the physical chord stops"
    );

    // The RegisterHotKey backstop: discarded after an injected sighting, deduped after a
    // physical one, and a stop of its own only when the hook saw nothing.
    let mut sightings = Sightings::default();
    sightings.record(Origin::Foreign, 1_000);
    assert_eq!(sightings.on_hotkey(1_100), HotkeyVerdict::Discard);
    let mut sightings = Sightings::default();
    sightings.record(Origin::Physical, 1_000);
    assert_eq!(sightings.on_hotkey(1_200), HotkeyVerdict::Dedupe);
    assert_eq!(
        Sightings::default().on_hotkey(5_000),
        HotkeyVerdict::BackstopStop
    );
    let mut sightings = Sightings::default();
    sightings.record(Origin::Foreign, 1_000);
    assert_eq!(
        sightings.on_hotkey(1_300),
        HotkeyVerdict::BackstopStop,
        "250 ms window only"
    );
}

#[test]
fn input_lock_drops_untagged_passes_tagged() {
    let tracker = PhysicalChord::default();
    let a = 0x41;
    assert_eq!(
        lock_verdict(&key(a, true, Origin::Physical, 1), true, true, &tracker),
        LockVerdict::Swallow
    );
    assert_eq!(
        lock_verdict(&key(a, true, Origin::Foreign, 1), true, true, &tracker),
        LockVerdict::Swallow
    );
    assert_eq!(
        lock_verdict(&key(a, true, Origin::Ours, 1), true, true, &tracker),
        LockVerdict::Pass
    );
    assert_eq!(
        lock_verdict(
            &key(VK_ESCAPE, true, Origin::Physical, 1),
            true,
            true,
            &tracker
        ),
        LockVerdict::Pass,
        "Esc ends the lease"
    );
    assert_eq!(
        lock_verdict(
            &key(VK_CONTROL, true, Origin::Physical, 1),
            true,
            true,
            &tracker
        ),
        LockVerdict::Pass,
        "stop chord keys pass"
    );
    // Default off, and no lease: the user's keys land.
    assert_eq!(
        lock_verdict(&key(a, true, Origin::Physical, 1), false, true, &tracker),
        LockVerdict::Pass
    );
    assert_eq!(
        lock_verdict(&key(a, true, Origin::Physical, 1), true, false, &tracker),
        LockVerdict::Pass
    );
}

#[test]
fn hold_ledger_skips_a_key_the_physical_chord_tracker_saw_down() {
    let mut tracker = PhysicalChord::default();
    tracker.on_key(&key(VK_SHIFT, true, Origin::Physical, 1));
    let mut ledger = Ledger::default();
    ledger.apply(&Entry::KeyDown(KeyUnit::virtual_key(VK_SHIFT, true)));
    ledger.apply(&Entry::KeyDown(KeyUnit::virtual_key(VK_CONTROL, true)));
    assert_eq!(
        replay(&ledger, &tracker.held()),
        vec![Step::KeyUp(KeyUnit::virtual_key(VK_CONTROL, false))]
    );
}
