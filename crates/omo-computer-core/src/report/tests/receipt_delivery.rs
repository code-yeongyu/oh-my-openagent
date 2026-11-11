//! A receipt proves the target consumed the input, so it sits only under
//! `delivered_verified`: never under `not_delivered/*` (whose retry claims nothing reached
//! the target) and never under `delivered_unverified` (defined as having no receipt).

use serde_json::json;

use super::{parts, wire_check};
use crate::report::{
    ActionReport, Delivered, Delivery, Disposition, Effect, Evidence, ReportContext, ReportParts,
    VerbClass,
};

fn counted(disposition: Disposition, effect: Effect, evidence: Vec<Evidence>) -> ReportParts {
    let mut parts = parts(disposition, effect, evidence);
    if effect == Effect::Partial {
        parts.delivered = Some(Delivered { count: 1, of: 2 });
    }
    parts
}

/// Through the constructor with a verb (no platform), or through the wire parse without one.
fn build(verb: Option<VerbClass>, parts: ReportParts) -> Result<ActionReport, String> {
    if let Some(verb) = verb {
        return ActionReport::new(ReportContext::new(verb, None), parts)
            .map_err(|error| format!("{error:?}"));
    }
    let wire = json!({
        "disposition": parts.disposition,
        "effect": parts.effect,
        "delivered": parts.delivered,
        "route": "background_pid",
        "evidence": parts.evidence,
        "observation": { "untrustedText": true }
    });
    wire_check(&wire, None)
}

#[test]
fn receipt_requires_a_delivered_verified_disposition() {
    let receipts = [
        Evidence::barrier_consumed(),
        Evidence::xi2_raw_confirm(),
        Evidence::value_readback(Some("x".to_owned()), Some("x".to_owned()), None),
    ];
    let unverified = Disposition::ALL.into_iter().filter(|pair| {
        matches!(
            pair.delivery(),
            Delivery::NotDelivered | Delivery::DeliveredUnverified
        )
    });
    let (mut refused, mut wire) = (0, 0);
    for disposition in unverified {
        for effect in Effect::ALL {
            for verb in [None, Some(VerbClass::Action), Some(VerbClass::Value)] {
                if build(verb, counted(disposition, effect, Vec::new())).is_err() {
                    continue;
                }
                for receipt in &receipts {
                    if verb == Some(VerbClass::Action) && receipt.intended().is_some() {
                        continue;
                    }
                    let label = format!(
                        "{}/{} {effect:?} {verb:?} with {:?}",
                        disposition.delivery().wire(),
                        disposition.retry().wire(),
                        receipt.kind()
                    );
                    let built = build(verb, counted(disposition, effect, vec![receipt.clone()]));
                    println!("{label}: {:?}", built.as_ref().err());
                    assert!(
                        built.is_err(),
                        "{label}: accepted, though the same report without the receipt is valid"
                    );
                    refused += 1;
                    wire += usize::from(verb.is_none());
                }
            }
        }
    }
    println!("{refused} receipts under a not-verified delivery refused, {wire} by the wire parse");
    assert!(
        refused >= 30 && wire >= 10,
        "the case list shrank: {refused}/{wire}"
    );
}
