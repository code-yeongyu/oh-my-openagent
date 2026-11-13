//! R59: the frame read-back kind follows design row C8, and every other kind derives as before.

use serde_json::json;

use super::wire_check;
use crate::listing::Rect;
use crate::report::{Evidence, EvidenceClass, EvidenceKind};

const ASKED: Rect = Rect { x: 10.0, y: 20.0, width: 500.0, height: 300.0 };

fn read_off(by: f64) -> Rect {
    Rect { x: ASKED.x + by, ..ASKED }
}

#[test]
fn frame_readback_is_a_receipt_within_1px_and_records_both_raw() {
    for (off, class) in [(0.0, EvidenceClass::Receipt), (0.5, EvidenceClass::Receipt), (1.0, EvidenceClass::Receipt), (1.5, EvidenceClass::Observation)] {
        let entry = Evidence::frame_readback(ASKED, read_off(off), None);
        assert_eq!(entry.class(), class, "{off} px off");
        let json = serde_json::to_value(&entry).expect("entry");
        assert_eq!(json["intended"], serde_json::json!("10,20,500,300"));
        assert_eq!(json["value"], serde_json::json!(format!("{},20,500,300", 10.0 + off)), "the raw read-back, never snapped");
    }
}

#[test]
fn every_existing_evidence_kind_derives_as_before() {
    let receipts_before = [EvidenceKind::BarrierConsumed, EvidenceKind::Xi2RawConfirm];
    for kind in EvidenceKind::ALL.into_iter().filter(|kind| *kind != EvidenceKind::FrameReadback) {
        let expected = if receipts_before.contains(&kind) { EvidenceClass::Receipt } else { EvidenceClass::Observation };
        assert_eq!(Evidence::derived_class(kind, Some("a"), Some("b")), expected, "{kind:?}, unequal");
        let equal = if receipts_before.contains(&kind) || kind == EvidenceKind::ValueReadback { EvidenceClass::Receipt } else { EvidenceClass::Observation };
        assert_eq!(Evidence::derived_class(kind, Some("a"), Some("a")), equal, "{kind:?}, equal");
    }
}

#[test]
fn a_frame_readback_on_the_wire_keeps_intended_and_other_kinds_still_may_not() {
    let frame = |kind: &str, class: &str| {
        json!({
            "effect": "confirmed",
            "route": "background_window",
            "delivered": { "count": 1, "of": 1 },
            "observation": { "untrustedText": true },
            "auditIds": [],
            "disposition": { "delivery": "delivered_verified", "retry": "unsafe" },
            "evidence": [{ "kind": kind, "class": class, "intended": "10,20,500,300", "value": "10,20,500,300" }],
        })
    };
    if let Err(error) = wire_check(&frame("frame_readback", "receipt"), None) {
        panic!("R59: frame_readback records both raw frames: {error}");
    }
    assert!(wire_check(&frame("barrier_consumed", "receipt"), None).is_err(), "intended stays refused on other kinds");
}
