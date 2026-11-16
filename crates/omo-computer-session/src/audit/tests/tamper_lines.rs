//! A-IS-62 R7-4, the cases inside a line or a writer key: each reads tampered in a process that
//! reads the hand for the first time. A segment is the lines of one (writerPid, writerProcStartMs)
//! key wherever they sit, and its chain (seq, prev) is checked within that key.

use serde_json::json;

use super::scan_fixture::{edit_stamped, lines, write_lines, Hand};
use crate::audit::{AuditLimits, Tamper, LINE_STAMP_BYTES};

#[test]
fn two_interleaved_writer_keys_read_not_tampered() {
    let hand = Hand::new();
    hand.healthy();
    assert_eq!(hand.read(), None);
}

#[test]
fn case_3_a_line_that_does_not_parse_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let mut all = lines(&hand.current());
    all.insert(3, "{\"v\":2,\"seq\":".to_owned());
    write_lines(&hand.current(), &all);
    assert_eq!(hand.read(), Some(Tamper::Unparseable));
}

#[test]
fn case_3_a_last_line_cut_mid_write_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let mut text = std::fs::read_to_string(hand.current()).expect("audit");
    let last = lines(&hand.current()).pop().expect("a last line");
    text.push_str(&last[..last.len() / 2]);
    std::fs::write(hand.current(), text).expect("a cut last line");
    assert_eq!(hand.read(), Some(Tamper::Unparseable));
}

#[test]
fn case_4_a_line_longer_than_max_event_plus_its_stamp_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let limit = AuditLimits::default().max_event + LINE_STAMP_BYTES;
    let long = usize::try_from(limit + 1).expect("fits");
    let mut all = lines(&hand.current());
    all.push(format!("{{\"pad\":\"{}\"}}", "a".repeat(long)));
    write_lines(&hand.current(), &all);
    assert_eq!(hand.read(), Some(Tamper::LongLine));
}

#[test]
fn case_5_a_key_with_no_audit_meta_before_its_first_line_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    edit_stamped(&hand.current(), 4, |line| line["writerPid"] = json!(99));
    assert_eq!(hand.read(), Some(Tamper::NoMeta));
}

#[test]
fn case_6_a_repeated_seq_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let mut all = lines(&hand.current());
    let again = all[3].clone();
    all.insert(4, again);
    write_lines(&hand.current(), &all);
    assert_eq!(hand.read(), Some(Tamper::Seq));
}

#[test]
fn case_6_a_skipped_seq_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    let mut all = lines(&hand.current());
    all.remove(4);
    write_lines(&hand.current(), &all);
    assert_eq!(hand.read(), Some(Tamper::Seq));
}

#[test]
fn case_7_a_broken_prev_within_a_key_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    edit_stamped(&hand.current(), 3, |line| line["prev"] = json!("0000000000000000"));
    assert_eq!(hand.read(), Some(Tamper::Prev));
}

#[test]
fn case_7_a_line_whose_content_changed_under_its_line_hash_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    edit_stamped(&hand.current(), 2, |line| line["target"] = json!("window:999"));
    assert_eq!(hand.read(), Some(Tamper::Prev));
}

#[test]
fn case_8_a_foreign_hand_id_reads_tampered() {
    let hand = Hand::new();
    hand.healthy();
    edit_stamped(&hand.current(), 1, |line| line["handId"] = json!("hand-2"));
    assert_eq!(hand.read(), Some(Tamper::ForeignHand));
}
