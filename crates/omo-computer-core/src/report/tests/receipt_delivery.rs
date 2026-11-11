//! A receipt is never under `not_delivered/*` (whose retry claims nothing reached the target)
//! or `delivered_unverified` (defined as having no receipt). A landed unit's receipt stays under
//! `delivery_uncertain/*` (LEAD ruling 2026-11-11), and never under `unknown/unknown` (LEAD
//! ruling 2026-11-11 (R13, #13147)): a proven landed unit makes the report `delivery_uncertain`.

use serde_json::json;

use super::{parts, wire_check};
use crate::report::{
    ActionReport, Delivered, Delivery, Disposition, Effect, Evidence, Platform, ReportContext,
    ReportParts, ReportRejection, Retry, VerbClass,
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
            Delivery::NotDelivered | Delivery::DeliveredUnverified | Delivery::Unknown
        )
    });
    let (mut refused, mut wire, mut unknown) = (0, 0, 0);
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
                    let why = built.err().unwrap_or_else(|| {
                        panic!("{label}: accepted, though the same report without the receipt is valid")
                    });
                    assert!(
                        why.contains("ReceiptWithoutVerifiedDelivery")
                            || why.contains("ConfirmingReceiptUnderOtherEffect"),
                        "{label}: refused for something other than the receipt: {why}"
                    );
                    refused += 1;
                    wire += usize::from(verb.is_none());
                    unknown += usize::from(disposition.delivery() == Delivery::Unknown);
                }
            }
        }
    }
    println!("{refused} receipts under a not-verified delivery refused, {wire} by the wire parse");
    assert!(
        refused >= 30 && wire >= 10,
        "the case list shrank: {refused}/{wire}"
    );
    assert!(unknown >= 10, "unknown/unknown is swept: {unknown} cases");
}

/// The acceptance side, per LEAD ruling 2026-11-11 (receipts record observation; disposition
/// records claim): an interrupted send's landed units keep their receipts while the report as a
/// whole stays `delivery_uncertain`. The design pin is silent on this pairing; the ruling settles it.
#[test]
fn landed_unit_receipts_stay_under_an_uncertain_partial_report() {
    let windows = ReportContext::new(VerbClass::Action, Some(Platform::Windows));
    for retry in [Retry::Unsafe, Retry::Unknown] {
        let Ok(uncertain) = Disposition::new(Delivery::DeliveryUncertain, retry) else {
            panic!("delivery_uncertain/{} is one of the seven", retry.wire());
        };
        let landed = || {
            counted(
                uncertain,
                Effect::Partial,
                vec![Evidence::barrier_consumed(), Evidence::barrier_consumed()],
            )
        };
        let built = ActionReport::new(windows, landed());
        println!(
            "delivery_uncertain/{} partial, 2 landed-unit barriers: {built:?}",
            retry.wire()
        );
        assert!(
            built.is_ok(),
            "the constructor refused landed-unit receipts: {built:?}"
        );
        let parsed = build(None, landed());
        assert!(
            parsed.is_ok(),
            "the wire parse refused landed-unit receipts: {parsed:?}"
        );
    }
    for (disposition, delivery) in [
        (Disposition::NOT_DELIVERED_SAFE, Delivery::NotDelivered),
        (
            Disposition::NOT_DELIVERED_AFTER_USER,
            Delivery::NotDelivered,
        ),
        (
            Disposition::DELIVERED_UNVERIFIED,
            Delivery::DeliveredUnverified,
        ),
    ] {
        let receipted = || {
            counted(
                disposition,
                Effect::Partial,
                vec![Evidence::barrier_consumed()],
            )
        };
        assert_eq!(
            ActionReport::new(windows, receipted()).err(),
            Some(ReportRejection::ReceiptWithoutVerifiedDelivery { delivery }),
            "{}: the rejection side still holds",
            delivery.wire()
        );
        let rejection = format!(
            "{:?}",
            ReportRejection::ReceiptWithoutVerifiedDelivery { delivery }
        );
        let parsed = build(None, receipted());
        assert!(
            parsed.as_ref().is_err_and(|why| why.contains(&rejection)),
            "{}: the wire parse still refuses with {rejection}: {parsed:?}",
            delivery.wire()
        );
    }
}

/// LEAD ruling 2026-11-11 (R13, #13147): a receipt under `unknown/unknown` is refused. A
/// proven landed unit makes the report `delivery_uncertain`; `unknown` means nothing was
/// observed, so a receipt contradicts it.
#[test]
fn receipt_under_unknown_delivery_is_refused() {
    let windows = ReportContext::new(VerbClass::Action, Some(Platform::Windows));
    let receipted = || {
        counted(
            Disposition::UNKNOWN,
            Effect::Partial,
            vec![Evidence::barrier_consumed()],
        )
    };
    let rejection = ReportRejection::ReceiptWithoutVerifiedDelivery {
        delivery: Delivery::Unknown,
    };
    let built = ActionReport::new(windows, receipted());
    println!("unknown/unknown partial with a barrier: {built:?}");
    assert_eq!(built.err(), Some(rejection), "the constructor");
    let parsed = build(None, receipted());
    assert!(
        parsed
            .as_ref()
            .is_err_and(|why| why.contains(&format!("{rejection:?}"))),
        "the wire parse refuses with {rejection:?}: {parsed:?}"
    );
    let bare = build(
        None,
        counted(Disposition::UNKNOWN, Effect::Partial, Vec::new()),
    );
    assert!(
        bare.is_ok(),
        "the same report without the receipt is valid: {bare:?}"
    );
}
