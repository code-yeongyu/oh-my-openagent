//! A-IS-62 R7-2 / R7-5, release-gate item (6): a chord refusal written by one writer key reads
//! tampered in a second reader, and until row 37 NOTHING clears it: a consent_save allow line in a
//! non-authority segment, a bootstrap write, or an anchor no host confirms (the read never starts
//! at an anchor in this PR).

use super::cap_refusal::chord_refusal;
use super::scan_fixture::{click, Hand};
use crate::audit::{AuditEvent, AuditLimits, AuditSink, Grant, GrantKind, GrantVerdict, Tamper};

fn consent_save_allow() -> AuditEvent {
    AuditEvent {
        action: "consent.save".to_owned(),
        target: "consent".to_owned(),
        grant: Some(Grant {
            kind: GrantKind::ConsentSave,
            verdict: GrantVerdict::Allow,
            consent: None,
            latch: None,
        }),
        ..AuditEvent::default()
    }
}

fn refused_hand() -> Hand {
    let hand = Hand::new();
    let mut engine = hand.writer(41, AuditLimits::default());
    engine.append(click()).expect("append");
    engine.append(chord_refusal("ctrl+q")).expect("the refusal line");
    hand
}

#[test]
fn a_refusal_written_by_one_writer_key_reads_tampered_in_a_second_reader() {
    let hand = refused_hand();
    let mut other = hand.writer(42, AuditLimits::default());
    other.append(click()).expect("another writer appends after it");
    assert_eq!(hand.read(), Some(Tamper::Marked));
}

#[test]
fn a_consent_save_allow_line_in_a_non_authority_segment_clears_nothing() {
    let hand = refused_hand();
    let mut other = hand.writer(42, AuditLimits::default());
    other.append(consent_save_allow()).expect("append");
    assert_eq!(hand.read(), Some(Tamper::Marked));
}

#[test]
fn a_bootstrap_write_in_the_authority_segment_clears_nothing() {
    let hand = refused_hand();
    let mut host = hand.authority(50, AuditLimits::default());
    host.append(consent_save_allow()).expect("the host's bootstrap consent_save");
    assert_eq!(hand.read(), Some(Tamper::Marked));
}

#[test]
fn an_anchor_no_host_confirms_clears_nothing_and_the_read_does_not_start_there() {
    let hand = refused_hand();
    let mut host = hand.authority(50, AuditLimits::default());
    host.append(click()).expect("the host's segment opens with its anchor");
    assert_eq!(hand.read(), Some(Tamper::Marked));
}

#[test]
fn a_refusal_line_cut_mid_write_reads_tampered() {
    let hand = Hand::new();
    let mut engine = hand.writer(41, AuditLimits::default());
    engine.append(click()).expect("append");
    let before = std::fs::read(hand.current()).expect("audit");
    engine.append(chord_refusal("ctrl+q")).expect("the refusal line");
    let after = std::fs::read(hand.current()).expect("audit");
    let cut = before.len() + (after.len() - before.len()) / 2;
    std::fs::write(hand.current(), &after[..cut]).expect("the write cut in half");
    assert_eq!(hand.read(), Some(Tamper::Unparseable));
}
