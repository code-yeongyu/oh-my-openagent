//! The low-level hooks (d-windows.md '## Capture guard and input lock').

use crate::input::ledger::{replay, Entry, Ledger, Step};
use crate::input::{KeyUnit, ENGINE_TAG, VK_CONTROL, VK_MENU, VK_SHIFT};
use crate::input_lock::{lock_verdict, LockVerdict};
use crate::stop_path::{
    is_chord, is_stop_chord_key, liveness, normalize_vk, HookEvent, HotkeyVerdict, Liveness,
    Origin, PhysicalChord, Sightings, StopCursor, VK_ESCAPE,
};

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

/// Review H1 (#13350): `WH_KEYBOARD_LL` reports modifiers as their left/right codes.
const VK_LSHIFT: u16 = 0xA0;
const VK_RSHIFT: u16 = 0xA1;
const VK_LCONTROL: u16 = 0xA2;
const VK_RCONTROL: u16 = 0xA3;
const VK_LMENU: u16 = 0xA4;
const VK_RMENU: u16 = 0xA5;

#[test]
fn left_and_right_modifier_codes_are_the_generic_modifiers() {
    for (side, generic) in [
        (VK_LSHIFT, VK_SHIFT),
        (VK_RSHIFT, VK_SHIFT),
        (VK_LCONTROL, VK_CONTROL),
        (VK_RCONTROL, VK_CONTROL),
        (VK_LMENU, VK_MENU),
        (VK_RMENU, VK_MENU),
    ] {
        assert_eq!(normalize_vk(side), generic);
        assert!(is_stop_chord_key(side), "{side:#x} is a stop chord key");
    }
    assert_eq!(normalize_vk(0x41), 0x41);
    assert_eq!(normalize_vk(VK_ESCAPE), VK_ESCAPE);
}

#[test]
fn the_physical_chord_typed_with_left_or_right_modifiers_stops() {
    for modifiers in [
        [VK_LCONTROL, VK_LMENU, VK_LSHIFT],
        [VK_RCONTROL, VK_RMENU, VK_RSHIFT],
    ] {
        let mut tracker = PhysicalChord::default();
        for vk in modifiers {
            assert_eq!(tracker.on_key(&key(vk, true, Origin::Physical, 1)), None);
        }
        let mut held = tracker.held();
        held.sort_unstable();
        assert_eq!(
            held,
            vec![VK_SHIFT, VK_CONTROL, VK_MENU],
            "held keys read as generic codes"
        );
        assert_eq!(
            tracker.on_key(&key(VK_ESCAPE, true, Origin::Physical, 2)),
            Some(Origin::Physical),
            "ctrl+alt+shift+escape from {modifiers:x?} stops"
        );
        for vk in modifiers {
            tracker.on_key(&key(vk, false, Origin::Physical, 3));
        }
        assert!(
            tracker.held().is_empty(),
            "a left/right key-up releases the generic key"
        );
    }
}

#[test]
fn the_hook_rule_needs_the_modifiers_for_every_origin() {
    let held_all = |vk: u16| [VK_SHIFT, VK_CONTROL, VK_MENU].contains(&vk);
    let held_none = |_: u16| false;
    for origin in [Origin::Physical, Origin::Ours, Origin::Foreign] {
        assert!(is_chord(&key(VK_ESCAPE, true, origin, 1), held_all));
        assert!(
            !is_chord(&key(VK_ESCAPE, true, origin, 1), held_none),
            "a bare Escape from {origin:?} is no chord sighting (else the engine's own Escape discards the user's backstop stop)"
        );
        assert!(
            !is_chord(&key(VK_ESCAPE, false, origin, 1), held_all),
            "a key-up is no sighting"
        );
    }
}

/// Review M1 (#13350): every listener sees each stop once; a dead listener thread is deaf.
#[test]
fn every_listener_reports_each_stop_once() {
    let mut first = StopCursor::at(0);
    let mut second = StopCursor::at(0);
    assert!(!first.take(0), "no stop counted yet");
    assert!(first.take(1), "the first listener sees the stop");
    assert!(second.take(1), "a second listener sees the same stop");
    assert!(!first.take(1), "a stop is reported once per listener");
    assert!(first.take(3), "later stops are seen");
    let mut late = StopCursor::at(3);
    assert!(
        !late.take(3),
        "a listener started after a stop does not report it"
    );
    assert!(late.take(4));
}

#[test]
fn a_listener_whose_thread_is_not_running_is_deaf() {
    assert_eq!(liveness(true, true, true), Liveness::Listening);
    assert_eq!(
        liveness(true, false, true),
        Liveness::Listening,
        "the hotkey alone still hears"
    );
    assert_eq!(
        liveness(true, true, false),
        Liveness::Listening,
        "the hook alone still hears"
    );
    assert_eq!(liveness(true, false, false), Liveness::Deaf);
    assert_eq!(
        liveness(false, true, true),
        Liveness::Deaf,
        "a thread that never started or whose loop ended hears nothing"
    );
    assert_eq!(liveness(false, false, false), Liveness::Deaf);
}
