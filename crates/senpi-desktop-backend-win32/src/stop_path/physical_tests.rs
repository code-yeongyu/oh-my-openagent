use super::*;
use crate::stop_path::chord::DEFAULT_STOP_CHORD;
use senpi_desktop_safety::Chord;

const VK_ESCAPE: u32 = 0x1B;

fn chord() -> PhysicalChord {
    PhysicalChord::new(Hotkey::parse(&Chord::parse(DEFAULT_STOP_CHORD).unwrap()).unwrap())
}

const fn physical(vk: u32, down: bool) -> KeyEvent {
    KeyEvent { vk, down, injected: false }
}

const fn injected(vk: u32, down: bool) -> KeyEvent {
    KeyEvent { vk, down, injected: true }
}

fn feed(chord: &mut PhysicalChord, events: &[KeyEvent]) -> Vec<Outcome> {
    events.iter().map(|event| chord.key(*event)).collect()
}

#[test]
fn a_physical_chord_stops_once_per_press() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[
            physical(VK_LCONTROL, true),
            physical(VK_LMENU, true),
            physical(VK_RSHIFT, true),
            physical(VK_ESCAPE, true),
            physical(VK_ESCAPE, true),
            physical(VK_ESCAPE, false),
            physical(VK_ESCAPE, true),
        ],
    );
    assert_eq!(outcomes[3], Outcome::Stop);
    assert_eq!(outcomes[4], Outcome::Other, "auto-repeat must not stop again");
    assert_eq!(outcomes[6], Outcome::Stop);
}

#[test]
fn an_injected_chord_never_stops() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[
            injected(VK_LCONTROL, true),
            injected(VK_LMENU, true),
            injected(VK_LSHIFT, true),
            injected(VK_ESCAPE, true),
        ],
    );
    assert_eq!(outcomes, [Outcome::Other, Outcome::Other, Outcome::Other, Outcome::InjectedTrigger]);
}

#[test]
fn injected_modifiers_never_complete_a_physical_trigger() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[injected(VK_LCONTROL, true), injected(VK_LMENU, true), injected(VK_LSHIFT, true), physical(VK_ESCAPE, true)],
    );
    assert_eq!(outcomes[3], Outcome::Other);
}

#[test]
fn an_injected_trigger_never_stops_while_a_person_holds_the_modifiers() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[physical(VK_CONTROL, true), physical(VK_MENU, true), physical(VK_SHIFT, true), injected(VK_ESCAPE, true)],
    );
    assert_eq!(outcomes[3], Outcome::InjectedTrigger);
}

#[test]
fn an_injected_key_up_never_releases_a_held_modifier() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[
            physical(VK_LCONTROL, true),
            physical(VK_LMENU, true),
            physical(VK_LSHIFT, true),
            injected(VK_LCONTROL, false),
            physical(VK_ESCAPE, true),
        ],
    );
    assert_eq!(outcomes[4], Outcome::Stop);
}

#[test]
fn releasing_one_side_of_a_doubled_modifier_keeps_the_other() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[
            physical(VK_LCONTROL, true),
            physical(VK_RCONTROL, true),
            physical(VK_LCONTROL, false),
            physical(VK_LMENU, true),
            physical(VK_LSHIFT, true),
            physical(VK_ESCAPE, true),
        ],
    );
    assert_eq!(outcomes[5], Outcome::Stop);
}

#[test]
fn a_missing_modifier_or_a_released_one_does_not_stop() {
    let mut chord = chord();
    let partial = feed(&mut chord, &[physical(VK_LCONTROL, true), physical(VK_LMENU, true), physical(VK_ESCAPE, true)]);
    assert_eq!(partial[2], Outcome::Other);
    let released = feed(
        &mut chord,
        &[physical(VK_ESCAPE, false), physical(VK_LSHIFT, true), physical(VK_LSHIFT, false), physical(VK_ESCAPE, true)],
    );
    assert_eq!(released[3], Outcome::Other);
}

#[test]
fn extra_held_keys_never_block_the_stop() {
    let mut chord = chord();
    let outcomes = feed(
        &mut chord,
        &[
            physical(VK_LWIN, true),
            physical(0x41, true),
            physical(VK_LCONTROL, true),
            physical(VK_LMENU, true),
            physical(VK_LSHIFT, true),
            physical(VK_ESCAPE, true),
        ],
    );
    assert_eq!(outcomes[5], Outcome::Stop);
}

fn seen(injected: bool, stopped: bool, at: Instant) -> Option<TriggerSeen> {
    Some(TriggerSeen { at, injected, stopped })
}

#[test]
fn the_hotkey_backstop_defers_to_what_the_hook_saw() {
    let now = Instant::now();
    assert!(!hotkey_needs_stop(seen(true, false, now), now), "an injected trigger must not stop");
    assert!(!hotkey_needs_stop(seen(false, true, now), now), "the hook already stopped");
    assert!(hotkey_needs_stop(seen(false, false, now), now), "a physical trigger the hook missed the modifiers of");
}

#[test]
fn a_hotkey_the_hook_did_not_see_stops() {
    let now = Instant::now();
    assert!(hotkey_needs_stop(None, now));
    let stale = now.checked_sub(TRIGGER_WINDOW + Duration::from_millis(1)).unwrap();
    assert!(hotkey_needs_stop(seen(true, false, stale), now), "a stale injected trigger must not mask a real press");
}
