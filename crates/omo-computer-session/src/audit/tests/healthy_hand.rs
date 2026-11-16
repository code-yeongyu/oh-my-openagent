//! Release-gate item (6)'s healthy-hand fixture (the pin's consent-chain-survives-three-rotations
//! case, d-safety.md:335): three rotations and a host restart with no refusal, and two live writers
//! interleaving, read NOT tampered, by a fresh process and by one that read along the way. It shows
//! the bound and the lock remove no capability.

use std::fs;

use super::scan_fixture::{click, Hand, HAND};
use crate::audit::{AuditLimits, AuditSink, HandScan};

const SMALL: AuditLimits = AuditLimits {
    rotate_at: 3_000,
    hard_cap: 64 * 1024 * 1024,
    max_event: 1024 * 1024,
};

#[test]
fn three_rotations_a_host_restart_and_two_live_writers_read_not_tampered() {
    let hand = Hand::new();
    let mut along = HandScan::default();
    let mut read_along = || along.read(hand.dir.path(), HAND, SMALL).tampered;
    let mut engine = hand.writer(41, SMALL);
    let mut other = hand.writer(42, SMALL);
    let mut rotations = 0;
    let mut host = hand.authority(30, SMALL);
    let mut seen = crate::audit::scan_identity(&hand.retired());
    let mut guard = 0;
    while rotations < 3 {
        host.append(click()).expect("host");
        engine.append(click()).expect("engine");
        other.append(click()).expect("other");
        assert_eq!(read_along(), None, "a process reading along sees a healthy hand");
        let now = crate::audit::scan_identity(&hand.retired());
        if now.is_some() && now != seen {
            rotations += 1;
            seen = now;
            if rotations == 2 {
                drop(host);
                host = hand.authority(31, SMALL);
            }
        }
        guard += 1;
        assert!(guard < 2_000, "three rotations happen");
    }
    assert!(fs::metadata(hand.current()).is_ok());
    assert_eq!(hand.read(), None, "a fresh process reads a healthy hand");
}
