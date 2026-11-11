//! The by-verb receipt rule, the no-change / suspected-no-op split and the focus
//! restoration values.

use serde_json::json;

use super::{context, parts};
use crate::report::{
    completed_effect, ActionReport, Disposition, Effect, Evidence, EvidenceClass, FocusRestoration,
    Platform, ReportContext, ReportRejection, Settle, VerbClass,
};

fn owned(text: &str) -> Option<String> {
    Some(text.to_owned())
}

#[test]
fn value_verb_readback_equality_is_the_receipt() {
    let equal = Evidence::value_readback(owned("x"), owned("x"), owned(""));
    let differs = Evidence::value_readback(owned("x"), owned("x!"), owned(""));
    let typed = Evidence::value_readback(owned("qabc"), owned("qabc"), owned("q"));
    let unrequested = Evidence::value_readback(None, owned("x"), owned("x"));
    assert_eq!(equal.class(), EvidenceClass::Receipt);
    assert_eq!(typed.class(), EvidenceClass::Receipt);
    assert_eq!(differs.class(), EvidenceClass::Observation);
    assert_eq!(unrequested.class(), EvidenceClass::Observation);
    for platform in Platform::ALL {
        let value = context(VerbClass::Value, platform);
        for receipt in [&equal, &typed] {
            let evidence = vec![receipt.clone()];
            assert_eq!(
                completed_effect(value, &evidence, Settle::NotQuiet),
                Effect::Confirmed
            );
            let built = ActionReport::new(
                value,
                parts(Disposition::DELIVERED_VERIFIED, Effect::Confirmed, evidence),
            );
            assert!(
                built.is_ok(),
                "{platform:?}: read-back equal to intended confirms: {built:?}"
            );
        }
        let evidence = vec![differs.clone()];
        assert_eq!(
            completed_effect(value, &evidence, Settle::NotQuiet),
            Effect::Observed
        );
        let confirmed = ActionReport::new(
            value,
            parts(
                Disposition::DELIVERED_VERIFIED,
                Effect::Confirmed,
                evidence.clone(),
            ),
        );
        assert_eq!(
            confirmed.err(),
            Some(ReportRejection::ConfirmedWithoutReceipt)
        );
        let observed = ActionReport::new(
            value,
            parts(
                Disposition::DELIVERED_UNVERIFIED,
                Effect::Observed,
                evidence,
            ),
        );
        assert!(
            observed.is_ok(),
            "{platform:?}: a differing read-back is observed: {observed:?}"
        );
        let on_click = ActionReport::new(
            context(VerbClass::Action, platform),
            parts(
                Disposition::DELIVERED_VERIFIED,
                Effect::Confirmed,
                vec![equal.clone()],
            ),
        );
        assert_eq!(on_click.err(), Some(ReportRejection::IntendedOnActionVerb));
    }
    let barrier_and_differs = vec![Evidence::barrier_consumed(), differs];
    let windows = context(VerbClass::Value, Platform::Windows);
    assert_eq!(
        completed_effect(windows, &barrier_and_differs, Settle::NotQuiet),
        Effect::Observed,
        "on a value verb the barrier raises delivery only; the read-back decides the effect"
    );
    let verified = ActionReport::new(
        windows,
        parts(
            Disposition::DELIVERED_VERIFIED,
            Effect::Observed,
            barrier_and_differs,
        ),
    );
    assert!(verified.is_ok(), "{verified:?}");
    for (tagged, label) in [
        (
            json!({ "kind": "value_readback", "class": "receipt", "value": "x", "baseline": "" }),
            "no intended",
        ),
        (
            json!({ "kind": "value_readback", "class": "receipt", "intended": "x", "value": "x!", "baseline": "" }),
            "value differs",
        ),
    ] {
        let parsed: Result<Evidence, _> = serde_json::from_value(tagged);
        println!("value_readback tagged receipt with {label}: {parsed:?}");
        assert!(
            parsed.is_err(),
            "{label}: a read-back that is not equal to intended is no receipt"
        );
    }
}

#[test]
fn no_change_vs_suspected_noop_split() {
    let samples = [
        Evidence::barrier_consumed(),
        Evidence::xi2_raw_confirm(),
        Evidence::value_readback(owned("x"), owned("x"), owned("")),
        Evidence::value_readback(None, owned("same"), owned("same")),
        Evidence::focus_readback(owned("a"), owned("a")),
        Evidence::menu_readback(owned("File"), owned("File")),
        Evidence::ax_notification("AXSheetCreated".to_owned()),
        Evidence::settle_frame_diff(),
        Evidence::ax_change(),
    ];
    let mut derived = 0;
    for mask in 0_u32..(1 << samples.len()) {
        let evidence: Vec<Evidence> = samples
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, entry)| entry.clone())
            .collect();
        for verb in [VerbClass::Action, VerbClass::Value] {
            for platform in Platform::ALL {
                for settle in [Settle::NotQuiet, Settle::QuietSuspect] {
                    let effect = completed_effect(
                        ReportContext::new(verb, Some(platform)),
                        &evidence,
                        settle,
                    );
                    assert_ne!(
                        effect,
                        Effect::NoChange,
                        "no_change is never produced: {evidence:?}"
                    );
                    derived += 1;
                }
            }
        }
    }
    println!("{derived} derivations, none no_change");
    let click = context(VerbClass::Action, Platform::Macos);
    let unchanged = vec![Evidence::value_readback(None, owned("same"), owned("same"))];
    assert_eq!(
        completed_effect(click, &unchanged, Settle::QuietSuspect),
        Effect::Observed
    );
    assert_eq!(
        completed_effect(click, &[], Settle::QuietSuspect),
        Effect::SuspectedNoop
    );
    assert_eq!(
        completed_effect(click, &[], Settle::NotQuiet),
        Effect::Unverifiable
    );
    assert_eq!(
        completed_effect(
            click,
            &[Evidence::settle_frame_diff()],
            Settle::QuietSuspect
        ),
        Effect::Unverifiable
    );
    let x11 = context(VerbClass::Action, Platform::X11);
    assert_eq!(
        completed_effect(x11, &[Evidence::xi2_raw_confirm()], Settle::QuietSuspect),
        Effect::SuspectedNoop,
        "the raw XI2 confirmation raises delivery only"
    );
    let suspected = ActionReport::new(
        click,
        parts(
            Disposition::DELIVERED_UNVERIFIED,
            Effect::SuspectedNoop,
            Vec::new(),
        ),
    );
    assert!(suspected
        .as_ref()
        .is_ok_and(|report| Disposition::ALL.contains(&report.disposition())));
    let observed_in_noop = ActionReport::new(
        click,
        parts(
            Disposition::DELIVERED_UNVERIFIED,
            Effect::SuspectedNoop,
            unchanged,
        ),
    );
    assert_eq!(
        observed_in_noop.err(),
        Some(ReportRejection::SuspectedNoopWithObservation)
    );
    let kept_in_union: Result<Effect, _> = serde_json::from_value(json!("no_change"));
    assert_eq!(
        kept_in_union.ok(),
        Some(Effect::NoChange),
        "no_change still parses"
    );
}

#[test]
fn focus_restoration_never_serialises_not_needed() {
    let spelled: Vec<String> = FocusRestoration::ALL
        .iter()
        .map(|value| {
            serde_json::to_value(value)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default()
        })
        .collect();
    println!("focusRestoration values: {spelled:?}");
    assert_eq!(
        spelled,
        ["untouched", "restored", "user_moved_on", "failed"]
    );
    let not_needed: Result<FocusRestoration, _> = serde_json::from_value(json!("not_needed"));
    assert!(
        not_needed.is_err(),
        "not_needed is outside the contract's type"
    );
    let schema = schemars::schema_for!(FocusRestoration);
    let listed = serde_json::to_string(schema.as_value()).unwrap_or_default();
    assert!(
        !listed.contains("not_needed"),
        "the schema never lists not_needed: {listed}"
    );
    for value in ["untouched", "restored", "user_moved_on", "failed"] {
        assert!(listed.contains(value), "the schema lists {value}");
    }
}
