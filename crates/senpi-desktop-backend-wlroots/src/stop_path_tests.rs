//! the sway binding stop path: chord parsing, event matching, and the live
//! listener against a fake sway socket.

use std::sync::Arc;
use std::time::Duration;

use senpi_desktop_safety::{Chord, FakeClock, StopPathListener as _, Supervisor};

use super::test_support::FakeSway;
use crate::stop_path::{BindChord, BindingEvent, SwayBindListener};

const WAIT: Duration = Duration::from_secs(3);

fn supervisor() -> Arc<Supervisor> {
    Arc::new(Supervisor::new(Arc::new(FakeClock::new(0))))
}

fn event(json: &str) -> BindingEvent {
    serde_json::from_str(json).expect("binding event")
}

const NESTED: &str = r#"{
  "change": "run",
  "command": "exec true",
  "binding": {
    "command": "exec true",
    "event_state_mask": ["Ctrl", "Shift"],
    "input_code": 0,
    "symbol": "Escape",
    "input_type": "keyboard"
  }
}"#;

const FLAT: &str = r#"{
  "change": "run",
  "command": "workspace 2",
  "event_state_mask": ["Mod4"],
  "input_code": 0,
  "symbol": "2",
  "input_type": "keyboard"
}"#;

#[test]
fn a_chord_parses_into_modifiers_and_a_keysym() {
    let chord = BindChord::parse(&Chord::parse("ctrl+shift+escape").unwrap()).unwrap();

    assert_eq!(chord.symbol, "Escape");
    assert_eq!(
        chord.modifiers,
        vec![
            senpi_desktop_core::keys::KeyName::Ctrl,
            senpi_desktop_core::keys::KeyName::Shift
        ]
    );

    let logo = BindChord::parse(&Chord::parse("super+f12").unwrap()).unwrap();
    assert_eq!(logo.symbol, "F12");

    let plain = BindChord::parse(&Chord::parse("a").unwrap()).unwrap();
    assert_eq!(plain.symbol, "a");
    assert!(plain.modifiers.is_empty());
}

#[test]
fn chords_without_exactly_one_key_are_invalid() {
    for chord in ["ctrl+alt", "ctrl+a+escape", "ctrl+bogus-key"] {
        let chord = Chord::parse(chord).unwrap();
        assert_eq!(
            BindChord::parse(&chord),
            Err(senpi_desktop_safety::StopPathError::InvalidChord(
                chord.to_string()
            ))
        );
    }
}

#[test]
fn a_nested_binding_event_matches_the_chord() {
    let chord = BindChord::parse(&Chord::parse("ctrl+shift+escape").unwrap()).unwrap();

    assert!(chord.matches(&event(NESTED)));
}

#[test]
fn a_flat_binding_event_matches_its_chord() {
    let chord = BindChord::parse(&Chord::parse("super+2").unwrap()).unwrap();

    assert!(chord.matches(&event(FLAT)));
}

#[test]
fn a_mismatched_modifier_set_or_symbol_does_not_match() {
    let chord = BindChord::parse(&Chord::parse("ctrl+shift+escape").unwrap()).unwrap();

    let extra_mod = event(
        r#"{"binding":{"event_state_mask":["Ctrl","Shift","Mod4"],"symbol":"Escape","input_type":"keyboard"}}"#,
    );
    assert!(
        !chord.matches(&extra_mod),
        "an extra modifier is a different binding"
    );

    let missing_mod = event(
        r#"{"binding":{"event_state_mask":["Ctrl"],"symbol":"Escape","input_type":"keyboard"}}"#,
    );
    assert!(!chord.matches(&missing_mod));

    let other_symbol = event(
        r#"{"binding":{"event_state_mask":["Ctrl","Shift"],"symbol":"F12","input_type":"keyboard"}}"#,
    );
    assert!(!chord.matches(&other_symbol));

    let mouse = event(
        r#"{"binding":{"event_state_mask":["Ctrl","Shift"],"symbol":"Escape","input_type":"mouse"}}"#,
    );
    assert!(!chord.matches(&mouse), "only keyboard bindings stop input");
}

#[test]
fn the_listener_subscribes_and_latches_on_a_matching_event() {
    let mut sway = FakeSway::start();
    let supervisor = supervisor();
    let mut listener = SwayBindListener::new();
    let chord = BindChord::parse(&Chord::parse("ctrl+shift+escape").unwrap()).unwrap();

    listener
        .start_on(chord, Arc::clone(&supervisor), sway.path.clone())
        .expect("subscribe");

    assert!(listener.is_live());
    assert_eq!(sway.subscribed_to().as_deref(), Some(r#"["binding"]"#));
    assert!(supervisor.status().global_live);

    sway.send_binding_event(NESTED);

    assert!(
        listener.wait_stops(1, WAIT),
        "the matching binding event latched the supervisor"
    );
    assert!(supervisor.status().suspended, "the stop latched");
}

#[test]
fn a_non_matching_event_never_latches() {
    let mut sway = FakeSway::start();
    let supervisor = supervisor();
    let mut listener = SwayBindListener::new();
    let chord = BindChord::parse(&Chord::parse("ctrl+shift+escape").unwrap()).unwrap();

    listener
        .start_on(chord, Arc::clone(&supervisor), sway.path.clone())
        .expect("subscribe");

    // A non-matching binding first: its acknowledgment is published only
    // after its effects, so the supervisor read between the two events is
    // stable and observes the non-matching event's own (non-)effect.
    sway.send_binding_event(FLAT);
    assert!(
        listener.wait_events(1, WAIT),
        "the non-matching binding was processed"
    );
    assert!(
        !supervisor.status().suspended,
        "a binding with the wrong modifiers and symbol does not latch"
    );
    assert_eq!(listener.stops(), 0);

    // Then the matching one: its acknowledgment implies the latch landed.
    sway.send_binding_event(NESTED);
    assert!(
        listener.wait_events(2, WAIT),
        "the matching binding was processed after the non-matching one"
    );
    assert!(
        supervisor.status().suspended,
        "the matching binding latched"
    );
    assert_eq!(listener.stops(), 1, "only the matching binding latched");
}

#[test]
fn a_socket_that_does_not_exist_is_unavailable() {
    let supervisor = supervisor();
    let mut listener = SwayBindListener::new();
    let chord = BindChord::parse(&Chord::parse("ctrl+escape").unwrap()).unwrap();
    let gone = tempfile::tempdir()
        .expect("tempdir")
        .path()
        .join("gone.sock");

    let error = listener
        .start_on(chord, supervisor, gone)
        .expect_err("no socket");

    assert!(matches!(
        error,
        senpi_desktop_safety::StopPathError::Unavailable { ref reason } if reason.contains("sway")
    ));
    assert!(!listener.is_live());
}

#[test]
fn an_invalid_chord_is_refused_before_any_listener_starts() {
    let supervisor = supervisor();
    let mut listener = SwayBindListener::new();

    let started = listener.start(&Chord::parse("ctrl+alt").unwrap(), supervisor);

    assert!(started.is_err());
    assert!(!listener.is_live());
}
