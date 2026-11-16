//! A-IS-62 R7-3 (release-gate item (6)): no rotation discards an unresolved refusal. The rotating
//! writer appends a carried mark as the last line of the file it retires and opens the new file
//! with a rotation_anchor that carries it, so a refusal survives any number of rotations and a
//! crash between the rename and the new file's first records.

use std::fs;

use super::cap_refusal::chord_refusal;
use super::scan_fixture::{click, Hand};
use crate::audit::{AuditLimits, AuditSink, Tamper};

const SMALL: AuditLimits = AuditLimits {
    rotate_at: 2_000,
    hard_cap: 64 * 1024 * 1024,
    max_event: 1024 * 1024,
};

/// The retired file's identity: a completed rotation replaces it.
fn retired_id(hand: &Hand) -> Option<(u64, u64)> {
    crate::audit::scan_identity(&hand.retired())
}

/// The authority appends until it has completed `n` more rotations.
fn rotate(host: &mut crate::audit::AuditWriter, hand: &Hand, n: usize) {
    for _ in 0..n {
        let before = retired_id(hand);
        let mut guard = 0;
        while retired_id(hand) == before {
            host.append(click()).expect("append");
            guard += 1;
            assert!(guard < 1_000, "the authority rotates at rotate_at");
        }
    }
}

#[test]
fn a_refusal_survives_two_rotations() {
    let hand = Hand::new();
    let mut host = hand.authority(30, SMALL);
    let mut engine = hand.writer(41, SMALL);
    engine.append(chord_refusal("ctrl+q")).expect("the refusal line");
    rotate(&mut host, &hand, 2);
    assert_eq!(hand.read(), Some(Tamper::Marked), "the mark is carried into each new file");
}

#[test]
fn a_refusal_survives_a_crash_between_the_rename_and_the_new_files_first_records() {
    let hand = Hand::new();
    let mut engine = hand.writer(41, SMALL);
    engine.append(chord_refusal("ctrl+q")).expect("the refusal line");
    // The crash: the file was retired and nothing of the new file was written.
    fs::rename(hand.current(), hand.retired()).expect("renamed");
    assert_eq!(hand.read(), Some(Tamper::Marked), "a rotation in progress is never a fresh hand");
    let mut host = hand.authority(30, SMALL);
    rotate(&mut host, &hand, 2);
    assert_eq!(hand.read(), Some(Tamper::Marked));
}
