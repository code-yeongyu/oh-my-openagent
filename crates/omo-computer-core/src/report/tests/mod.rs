//! The result contract's tests: the disposition table, the receipt rule by verb, the wire
//! shapes, and the imported corpus values against the contract's types.

mod imported;
mod receipts;
mod shape_cases;
mod shapes;

use serde_json::{json, Value};

use super::{
    ActionReport, Delivery, Disposition, Effect, Evidence, FocusRestoration, Platform,
    ReportContext, ReportParts, ReportRejection, Retry, Route, VerbClass,
};
use crate::untrusted::UntrustedText;

fn parts(disposition: Disposition, effect: Effect, evidence: Vec<Evidence>) -> ReportParts {
    ReportParts {
        disposition,
        delivered: None,
        effect,
        route: Route::BackgroundPid,
        hit: None,
        focus_restoration: Some(FocusRestoration::Untouched),
        opened_surfaces: Vec::new(),
        next_call: None,
        note: None,
        warning: None,
        audit_ids: Vec::new(),
        timings: None,
        evidence,
        observation: UntrustedText,
    }
}

const fn context(verb: VerbClass, platform: Platform) -> ReportContext {
    ReportContext::new(verb, Some(platform))
}

/// Parses `report` as the wire does, then runs the per-(verb, report) rules.
fn wire_check(report: &Value, context: Option<ReportContext>) -> Result<ActionReport, String> {
    let parsed: ActionReport =
        serde_json::from_value(report.clone()).map_err(|error| error.to_string())?;
    if let Some(context) = context {
        parsed
            .validate(context)
            .map_err(|error| error.to_string())?;
    }
    Ok(parsed)
}

#[test]
fn every_exec_reply_method_has_a_verb_class() {
    for spec in crate::methods::METHODS {
        let classed = VerbClass::of(spec.method).is_some();
        assert_eq!(
            classed,
            spec.result == "ExecReply",
            "{}: verb class",
            spec.name
        );
    }
}

#[test]
fn disposition_table_accepts_7_rejects_13() {
    let (mut accepted, mut rejected) = (Vec::new(), Vec::new());
    for delivery in Delivery::ALL {
        for retry in Retry::ALL {
            let label = format!("{}/{}", delivery.wire(), retry.wire());
            let built = Disposition::new(delivery, retry);
            let parsed: Result<Disposition, _> = serde_json::from_value(
                json!({ "delivery": delivery.wire(), "retry": retry.wire() }),
            );
            assert_eq!(
                built.is_ok(),
                parsed.is_ok(),
                "{label}: the constructor and the wire parse disagree"
            );
            match built {
                Ok(pair) => {
                    assert!(Disposition::ALL.contains(&pair), "{label} is not in ALL");
                    assert_eq!(parsed.ok(), Some(pair), "{label}: the wire parse differs");
                    println!("accepted {label}");
                    accepted.push(label);
                }
                Err(error) => {
                    println!("rejected {label}: {error}");
                    rejected.push(label);
                }
            }
        }
    }
    assert_eq!(accepted.len(), 7, "accepted: {accepted:?}");
    assert_eq!(rejected.len(), 13, "rejected: {rejected:?}");
    assert!(rejected
        .iter()
        .any(|label| label == "delivered_unverified/after_user"));
    let schema = schemars::schema_for!(Disposition);
    let pairs = schema.as_value()["oneOf"].as_array().map_or(0, Vec::len);
    assert_eq!(
        pairs, 7,
        "the schema's oneOf lists every valid pair and no other"
    );
}

#[test]
fn action_report_confirmed_requires_receipt() {
    let observation_only = vec![
        Evidence::focus_readback(Some("Save".to_owned()), Some("Open".to_owned())),
        Evidence::ax_notification("AXSheetCreated".to_owned()),
    ];
    for platform in Platform::ALL {
        for verb in [VerbClass::Action, VerbClass::Value] {
            for evidence in [Vec::new(), observation_only.clone()] {
                let entries = evidence.len();
                let built = ActionReport::new(
                    context(verb, platform),
                    parts(Disposition::DELIVERED_VERIFIED, Effect::Confirmed, evidence),
                );
                println!("confirmed, {entries} observation-class entries, {verb:?} on {platform:?}: {built:?}");
                assert_eq!(built.err(), Some(ReportRejection::ConfirmedWithoutReceipt));
            }
        }
    }
    let wire = json!({
        "disposition": { "delivery": "delivered_verified", "retry": "unsafe" },
        "effect": "confirmed",
        "route": "background_pid",
        "evidence": [{ "kind": "focus_readback", "class": "observation", "value": "Save", "baseline": "Open" }],
        "observation": { "untrustedText": true }
    });
    let parsed = wire_check(&wire, None);
    println!("wire parse of the same shape: {parsed:?}");
    assert!(
        parsed.is_err(),
        "the wire parse must refuse it as the constructor does"
    );
    let barrier = ActionReport::new(
        context(VerbClass::Action, Platform::Windows),
        parts(
            Disposition::DELIVERED_VERIFIED,
            Effect::Confirmed,
            vec![Evidence::barrier_consumed()],
        ),
    );
    assert!(
        barrier.is_ok(),
        "a Windows click with its barrier receipt: {barrier:?}"
    );
}
