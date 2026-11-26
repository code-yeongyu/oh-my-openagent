use omo_computer_core::report::{Disposition, Effect};
use serde_json::json;

use super::ReadBack;

#[test]
fn value_verb_confirmed_only_on_equality() {
    let equal = ReadBack::judge("x", Some("x".to_owned()), Some(String::new()));
    assert_eq!(equal.effect, Effect::Confirmed);
    assert_eq!(serde_json::to_value(&equal.evidence[0]).expect("entry")["class"], json!("receipt"));
    assert_eq!(equal.next_call, None);
}

#[test]
fn value_readback_mismatch_is_observed_and_keeps_the_generation() {
    let differs = ReadBack::judge("x", Some("x!".to_owned()), Some("before".to_owned()));
    assert_eq!(differs.effect, Effect::Observed);
    assert_eq!(differs.disposition, Disposition::DELIVERED_UNVERIFIED);
    let entry = serde_json::to_value(&differs.evidence[0]).expect("entry");
    assert_eq!(entry["class"], json!("observation"));
    assert_eq!((&entry["intended"], &entry["value"], &entry["baseline"]), (&json!("x"), &json!("x!"), &json!("before")));
    assert_eq!(differs.next_call.as_deref(), Some("observe"));
}

#[test]
fn unreadable_value_is_unverifiable_and_forces_observe() {
    let unreadable = ReadBack::judge("x", None, None);
    assert_eq!(unreadable.effect, Effect::Unverifiable);
    assert!(unreadable.evidence.is_empty());
    assert_eq!(unreadable.next_call.as_deref(), Some("observe"));
}
