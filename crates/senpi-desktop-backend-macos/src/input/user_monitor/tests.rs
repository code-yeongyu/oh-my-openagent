//! Ported from oh-my-pi `desktop/control/macos.rs` tests (`foreign`,
//! `input_target`), plus the record the tap feeds.

use std::time::Instant;

use super::*;

const OWN_PID: i64 = 900;

fn unread() -> Option<libc::pid_t> {
    panic!("the front process is not read")
}

fn heard(tag: i64, source_pid: i64, target: i64) -> Heard {
    Heard {
        tag,
        source_pid,
        target,
    }
}

#[test]
fn the_users_and_their_tools_input_is_foreign_and_the_engines_is_not() {
    // Hardware input carries no source process.
    assert!(foreign(0, 0, OWN_PID));
    // A dictation tool posts under its own process id.
    assert!(foreign(0, 4242, OWN_PID));
    // Anything the engine posts carries its tag, whoever relays it.
    assert!(!foreign(ENGINE_EVENT_TAG, 0, OWN_PID));
    assert!(!foreign(ENGINE_EVENT_TAG, 4242, OWN_PID));
    // An untagged event the engine posted is still its own.
    assert!(!foreign(0, OWN_PID, OWN_PID));
}

#[test]
fn foreign_input_lands_in_its_annotated_target_or_a_key_in_the_front_process() {
    assert_eq!(input_target(KEY_DOWN, 77, unread), Some(77));
    assert_eq!(input_target(LEFT_MOUSE_DOWN, 77, unread), Some(77));
    assert_eq!(input_target(KEY_DOWN, 0, || Some(12)), Some(12));
    assert_eq!(input_target(KEY_DOWN, 0, || None), None);
    assert_eq!(input_target(LEFT_MOUSE_DOWN, 0, unread), None);
    assert_eq!(input_target(RIGHT_MOUSE_DOWN, -1, unread), None);
    assert_eq!(input_target(OTHER_MOUSE_DOWN, 0, unread), None);
    // A type without a rule counts against the front process rather than
    // being dropped.
    assert_eq!(input_target(11, 0, || Some(12)), Some(12));
}

#[test]
fn the_watch_records_the_users_presses_by_the_process_they_land_in() {
    // Given
    let log = UserInputLog::default();
    // When
    log.observe(KEY_DOWN, heard(0, 0, 77), OWN_PID, unread);
    log.observe(LEFT_MOUSE_DOWN, heard(0, 4242, 78), OWN_PID, unread);
    log.observe(KEY_DOWN, heard(ENGINE_EVENT_TAG, 0, 77), OWN_PID, unread);
    log.observe(RIGHT_MOUSE_DOWN, heard(0, 0, 0), OWN_PID, unread);
    log.observe(KEY_DOWN, heard(0, 0, 0), OWN_PID, || Some(12));
    // Then
    let taken = log.take();
    let presses: Vec<_> = taken
        .presses
        .iter()
        .map(|press| (press.pid, press.kind))
        .collect();
    assert_eq!(
        presses,
        [
            (77, UserPressKind::Key),
            (78, UserPressKind::Click),
            (12, UserPressKind::Key)
        ]
    );
    assert_eq!(taken.dropped, 0);
    assert!(log.take().presses.is_empty(), "a read empties the record");
}

#[test]
fn a_full_record_keeps_the_newest_presses_and_counts_the_ones_it_let_go() {
    // Given
    let log = UserInputLog::default();
    let at = Instant::now();
    let capacity = u32::try_from(LOG_CAPACITY).unwrap();
    // When
    for pid in 0..capacity + 3 {
        log.record(UserPress {
            pid,
            kind: UserPressKind::Key,
            at,
        });
    }
    // Then
    let taken = log.take();
    assert_eq!(taken.dropped, 3);
    assert_eq!(taken.presses.len(), LOG_CAPACITY);
    assert_eq!(taken.presses.first().map(|press| press.pid), Some(3));
    assert_eq!(log.take().dropped, 0, "a read clears the count");
}

#[test]
fn without_accessibility_trust_no_tap_is_created_the_watch_is_off_and_it_is_never_retried() {
    // Given
    let mut watch = UserInputWatch::default();
    // When
    watch.start_with(
        || false,
        |_| panic!("a tap was created without Accessibility trust"),
    );
    // Then
    assert_eq!(watch.state(), InterventionWatch::Off);
    assert_eq!(watch.take(), UserPresses::default());
    // When: later requests start it again.
    for _ in 0..3 {
        watch.start_with(
            || panic!("trust was asked again"),
            |_| panic!("a tap was created on a later request"),
        );
    }
    // Then
    assert_eq!(watch.state(), InterventionWatch::Off);
}

#[test]
fn a_trusted_watch_whose_tap_macos_refuses_is_off_and_never_retried() {
    let mut watch = UserInputWatch::default();
    let mut taps = 0;
    watch.start_with(
        || true,
        |_| {
            taps += 1;
            None
        },
    );
    watch.start_with(|| true, |_| panic!("the refused tap was retried"));
    assert_eq!(taps, 1);
    assert_eq!(watch.state(), InterventionWatch::Off);
}

#[test]
fn a_watch_that_never_started_reports_not_started_and_has_nothing_to_read() {
    let watch = UserInputWatch::default();
    assert_eq!(watch.state(), InterventionWatch::NotStarted);
    assert_eq!(watch.take(), UserPresses::default());
}
