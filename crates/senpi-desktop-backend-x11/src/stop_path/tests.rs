//! The stop chord: parsing, keycode resolution, and matching raw key events.

use std::sync::Arc;

use senpi_desktop_safety::{Chord, FakeClock, StopPathError, StopPathListener, Supervisor};

use super::chord::{Hotkey, Pressed, DEFAULT_STOP_CHORD, UNMAPPED_CHORD};
use super::Xi2Listener;
use crate::input::fake::{keymap, KEY_A, KEY_ALT_L, KEY_CONTROL_L, KEY_ESCAPE, KEY_SHIFT_L, KEY_SHIFT_R};

fn default_codes() -> super::chord::ChordCodes {
    Hotkey::parse(&Chord::parse(DEFAULT_STOP_CHORD).unwrap())
        .unwrap()
        .resolve(&keymap())
        .unwrap()
}

#[test]
fn the_default_chord_latches_only_when_every_modifier_is_down() {
    let codes = default_codes();
    let mut pressed = Pressed::default();

    let early = [KEY_CONTROL_L, KEY_ALT_L].map(|code| pressed.press(code, &codes));
    let missing_shift = pressed.press(KEY_ESCAPE, &codes);
    pressed.release(KEY_ESCAPE);
    let shift = pressed.press(KEY_SHIFT_L, &codes);
    let full = pressed.press(KEY_ESCAPE, &codes);

    assert_eq!(early, [false, false]);
    assert!(!missing_shift, "escape without shift is not the chord");
    assert!(!shift, "a modifier is never the trigger");
    assert!(full);
}

#[test]
fn either_side_of_a_modifier_counts_and_extra_keys_do_not_block_the_stop() {
    let codes = default_codes();
    let mut pressed = Pressed::default();

    for code in [KEY_A, KEY_CONTROL_L, KEY_ALT_L, KEY_SHIFT_R] {
        pressed.press(code, &codes);
    }

    assert!(pressed.press(KEY_ESCAPE, &codes));
}

#[test]
fn a_released_modifier_no_longer_counts() {
    let codes = default_codes();
    let mut pressed = Pressed::default();
    for code in [KEY_CONTROL_L, KEY_ALT_L, KEY_SHIFT_L] {
        pressed.press(code, &codes);
    }

    pressed.release(KEY_ALT_L);

    assert!(!pressed.press(KEY_ESCAPE, &codes));
}

#[test]
fn a_chord_needs_exactly_one_non_modifier_key() {
    for chord in ["ctrl+alt", "ctrl+a+escape", "ctrl+bogus-key"] {
        let chord = Chord::parse(chord).unwrap();
        assert_eq!(
            Hotkey::parse(&chord),
            Err(StopPathError::InvalidChord(chord.to_string()))
        );
    }
}

#[test]
fn a_chord_the_keymap_cannot_type_is_unavailable() {
    let hotkey = Hotkey::parse(&Chord::parse("ctrl+f24").unwrap()).unwrap();

    let error = hotkey.resolve(&keymap()).unwrap_err();

    assert_eq!(error.reason(), UNMAPPED_CHORD);
}

#[test]
fn an_invalid_chord_is_refused_before_any_listener_starts() {
    let supervisor = Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))));
    let mut listener = Xi2Listener::new();

    let started = listener.start(&Chord::parse("ctrl+alt").unwrap(), supervisor.clone());

    assert_eq!(started.unwrap_err().reason(), "invalid-chord");
    assert!(!listener.is_live());
    assert!(!supervisor.status().global_live);
}
