use std::sync::Arc;
use std::time::Duration;

use senpi_desktop_safety::{
    ActiveStopPath, Chord, FakeClock, StopPathError, StopPathListener, StopPolicy, StopSource, Supervisor,
    HEARTBEAT_FRESH_MS, HEARTBEAT_INTERVAL_MS,
};

use super::chord::{Hotkey, DEFAULT_STOP_CHORD};
use super::tap::{
    classify, listener_step_is_live, TapAction, EVENT_KEY_DOWN, RUN_LOOP_HANDLED_SOURCE, RUN_LOOP_TIMED_OUT,
    TAP_DISABLED_BY_TIMEOUT, TAP_DISABLED_BY_USER_INPUT,
};
use super::{CgEventTapListener, Ladder, Shared, Wake};

const ESCAPE: i64 = 53;
const CONTROL: u64 = 0x0004_0000;
const OPTION: u64 = 0x0008_0000;
const COMMAND: u64 = 0x0010_0000;
const SHIFT: u64 = 0x0002_0000;
const GLOBAL_ONLY: StopPolicy = StopPolicy {
    allow_host_relay_only: false,
};

fn hotkey(chord: &str) -> Result<Hotkey, StopPathError> {
    Hotkey::parse(&Chord::parse(chord).unwrap())
}

fn shared(chord: &str) -> (Shared, Arc<FakeClock>) {
    let clock = Arc::new(FakeClock::new(1_000));
    let supervisor = Arc::new(Supervisor::new(clock.clone()));
    (Shared::new(supervisor, hotkey(chord).unwrap()), clock)
}

#[test]
fn default_chord_matches_only_escape_with_control_option_command() {
    let default = hotkey(DEFAULT_STOP_CHORD).unwrap();
    let all = CONTROL | OPTION | COMMAND;
    assert!(default.matches_hotkey(ESCAPE, all));
    assert!(
        default.matches_hotkey(ESCAPE, all | SHIFT),
        "extra modifiers still stop"
    );
    assert!(!default.matches_hotkey(ESCAPE, CONTROL | OPTION));
    assert!(!default.matches_hotkey(ESCAPE, 0));
    assert!(!default.matches_hotkey(0, all));
}

#[test]
fn modifier_aliases_parse_to_the_same_hotkey() {
    let canonical = hotkey("ctrl+alt+meta+escape").unwrap();
    for chord in [
        "control+option+cmd+esc",
        "ctrl+opt+command+escape",
        "CTRL+OPT+CMD+ESCAPE",
        "escape+cmd+opt+ctrl",
    ] {
        assert_eq!(hotkey(chord), Ok(canonical), "{chord}");
    }
}

#[test]
fn a_chord_with_other_keys_maps_their_macos_keycodes() {
    let chord = hotkey("shift+f12").unwrap();
    assert!(chord.matches_hotkey(111, SHIFT));
    assert!(!chord.matches_hotkey(111, 0));
}

#[test]
fn chords_the_key_down_tap_cannot_see_are_rejected() {
    for chord in ["ctrl+alt", "ctrl+a+b", "ctrl+hyper", "cmd+\u{e9}"] {
        assert_eq!(
            hotkey(chord),
            Err(StopPathError::InvalidChord(chord.to_owned())),
            "{chord}"
        );
    }
}

#[test]
fn an_invalid_chord_fails_start_before_any_tap_exists() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    let mut listener = CgEventTapListener::new();
    let started = listener.start(&Chord::parse("ctrl+alt").unwrap(), shared.supervisor.clone());
    assert_eq!(started, Err(StopPathError::InvalidChord("ctrl+alt".to_owned())));
    assert!(!listener.is_live());
    assert!(listener.shared.is_none());
}

#[test]
fn the_re_arm_ladder_backs_off_from_250_ms_to_4_s_then_parks() {
    let mut ladder = Ladder::default();
    let delays: Vec<Option<Duration>> = (0..7).map(|_| ladder.next_delay()).collect();
    let ms = |ms| Some(Duration::from_millis(ms));
    assert_eq!(
        delays,
        [ms(250), ms(500), ms(1_000), ms(2_000), ms(4_000), None, None]
    );
}

#[test]
fn only_an_enabled_tap_on_a_serviced_run_loop_stays_live() {
    assert!(listener_step_is_live(RUN_LOOP_TIMED_OUT, true));
    assert!(listener_step_is_live(RUN_LOOP_HANDLED_SOURCE, true));
    assert!(!listener_step_is_live(RUN_LOOP_TIMED_OUT, false), "disabled tap");
    for finished in [0, 1, 2] {
        assert!(
            !listener_step_is_live(finished, true),
            "run loop result {finished}"
        );
    }
}

#[test]
fn the_callback_re_enables_on_both_disable_notices_and_reads_only_key_downs() {
    assert_eq!(classify(TAP_DISABLED_BY_TIMEOUT), TapAction::ReEnable);
    assert_eq!(classify(TAP_DISABLED_BY_USER_INPUT), TapAction::ReEnable);
    assert_eq!(classify(EVENT_KEY_DOWN), TapAction::KeyDown);
    assert_eq!(classify(11), TapAction::PassThrough, "key-up");
}

#[test]
fn the_chord_latches_a_hotkey_stop() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    shared.key_down(ESCAPE, CONTROL | OPTION | COMMAND);
    let status = shared.supervisor.status();
    assert!(status.suspended);
    assert_eq!(status.stopped_by, Some(StopSource::Hotkey));
    assert_eq!(shared.control.lock().stops, 1);
}

#[test]
fn other_key_downs_never_stop() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    shared.key_down(ESCAPE, CONTROL | OPTION);
    shared.key_down(0, CONTROL | OPTION | COMMAND);
    assert!(!shared.supervisor.is_suspended());
    assert_eq!(shared.control.lock().stops, 0);
}

#[test]
fn listener_heartbeats_keep_the_global_path_fresh_past_the_window() {
    let (shared, clock) = shared(DEFAULT_STOP_CHORD);
    shared.set_live(true);
    for _ in 0..=(HEARTBEAT_FRESH_MS / HEARTBEAT_INTERVAL_MS) {
        clock.advance(HEARTBEAT_INTERVAL_MS);
        shared.heartbeat();
    }
    assert_eq!(shared.supervisor.status().stop_path, ActiveStopPath::Global);
    assert!(shared.supervisor.input_allowed(&GLOBAL_ONLY));
}

#[test]
fn a_failed_tap_refuses_input_and_ends_the_start_wait() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    shared.set_live(true);
    shared.tap_failed();
    assert!(!shared.supervisor.status().global_live);
    assert!(!shared.supervisor.input_allowed(&GLOBAL_ONLY));
    // A failure past the captured count ends the wait at once; the timeout is
    // only a hang guard.
    assert!(!shared.wait_live(0, Duration::from_secs(30)));
}

#[test]
fn restart_wakes_a_parked_listener_with_a_fresh_ladder() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    shared.request_restart();
    assert_eq!(shared.wait_to_retry(None), Wake::Restart);
    assert!(!shared.control.lock().restart, "the request is consumed");
}

#[test]
fn restart_is_ignored_while_the_tap_is_live() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    shared.set_live(true);
    shared.request_restart();
    assert!(!shared.control.lock().restart);
}

#[test]
fn shutdown_wins_over_restart_and_an_elapsed_rung_retries() {
    let (shared, _clock) = shared(DEFAULT_STOP_CHORD);
    assert_eq!(shared.wait_to_retry(Some(Duration::ZERO)), Wake::Retry);
    shared.request_restart();
    shared.update(|control| control.shutdown = true);
    assert_eq!(shared.wait_to_retry(None), Wake::Shutdown);
}
