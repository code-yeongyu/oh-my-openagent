//! A-IS-62 R7-4, the cases about the hand's files: absent files read not tampered; a file that
//! cannot be read, is not a regular file, is over the read cap, opens after a rotation with an
//! anchor that does not link to the retired file, or lost a lineHash this process held, reads
//! tampered.

use std::fs;

use serde_json::json;

use super::scan_fixture::{click, edit_stamped, Hand, HAND};
use crate::audit::{AuditLimits, AuditSink, HandScan, Tamper, LOCK_FILE};

#[test]
fn no_audit_jsonl_no_audit_1_jsonl_and_no_audit_lock_read_not_tampered() {
    let hand = Hand::new();
    assert_eq!(hand.read(), None);
    assert!(!hand.hand_dir().join(LOCK_FILE).exists(), "the read creates nothing");
}

#[cfg(unix)]
#[test]
fn case_1_an_audit_file_that_cannot_be_read_reads_tampered() {
    use std::os::unix::fs::PermissionsExt;
    let hand = Hand::new();
    hand.healthy();
    fs::set_permissions(hand.current(), fs::Permissions::from_mode(0o000)).expect("chmod");
    assert_eq!(hand.read(), Some(Tamper::Unreadable));
}

#[cfg(unix)]
#[test]
fn case_2_a_symlink_at_audit_jsonl_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let elsewhere = hand.dir.path().join("elsewhere.jsonl");
    fs::rename(hand.current(), &elsewhere).expect("move");
    std::os::unix::fs::symlink(&elsewhere, hand.current()).expect("symlink");
    assert_eq!(hand.read(), Some(Tamper::NotRegular));
}

#[test]
fn case_2_a_directory_at_audit_1_jsonl_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    fs::create_dir(hand.retired()).expect("a directory where the retired file goes");
    assert_eq!(hand.read(), Some(Tamper::NotRegular));
}

#[test]
fn case_9_an_anchor_opening_the_file_after_a_rotation_that_does_not_link_reads_tampered() {
    let hand = Hand::new();
    let limits = AuditLimits {
        rotate_at: 2_000,
        ..AuditLimits::default()
    };
    let mut host = hand.authority(30, limits);
    while !hand.retired().exists() {
        host.append(click()).expect("append");
    }
    assert_eq!(hand.read(), None, "a completed rotation reads not tampered");
    edit_stamped(&hand.current(), 0, |anchor| {
        assert_eq!(anchor["grant"]["verdict"], json!("rotation_anchor"));
        anchor["prev"] = json!("0000000000000000");
    });
    assert_eq!(hand.read(), Some(Tamper::AnchorLink));
}

#[test]
fn case_10_a_file_over_the_read_cap_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let limits = AuditLimits::default();
    let file = fs::OpenOptions::new().write(true).open(hand.current()).expect("open");
    file.set_len(limits.hard_cap + limits.max_event + 1).expect("grow");
    assert_eq!(hand.read(), Some(Tamper::OverCap));
}

#[test]
fn case_11_a_line_hash_this_process_held_that_vanished_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let mut process = HandScan::default();
    let read = |scan: &mut HandScan| scan.read(hand.dir.path(), HAND, AuditLimits::default()).tampered;
    assert_eq!(read(&mut process), None, "the first read keeps its offset");
    let kept = fs::metadata(hand.current()).expect("stat").len();
    let file = fs::OpenOptions::new().write(true).open(hand.current()).expect("open");
    file.set_len(kept / 2).expect("the file shrinks with no rotation");
    assert_eq!(read(&mut process), Some(Tamper::Vanished));
}

#[test]
fn case_11_a_removed_audit_after_a_read_reads_tampered_in_that_process() {
    let hand = Hand::new();
    hand.healthy();
    let mut process = HandScan::default();
    let read = |scan: &mut HandScan| scan.read(hand.dir.path(), HAND, AuditLimits::default()).tampered;
    assert_eq!(read(&mut process), None);
    fs::remove_file(hand.current()).expect("removed");
    assert_eq!(read(&mut process), Some(Tamper::Vanished));
    assert_eq!(hand.read(), None, "a process that never read it sees no audit: the named residual");
}
