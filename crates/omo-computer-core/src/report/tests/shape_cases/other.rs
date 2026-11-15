//! The other invalid shapes: verb and platform receipts, effect-delivery couplings and
//! malformed members.

use serde_json::{json, Value};

use super::{confirmed, ctx, entry, observed, shape, Shape, CLICK, VALUE};
use crate::report::{Platform, ReportContext};

pub(super) fn shapes() -> Vec<Shape> {
    let none = json!({});
    let read = json!({ "value": "b", "baseline": "a" });
    let event = json!({ "event": "AXSheetCreated" });
    let mut shapes = Vec::new();
    let mut add = |c3: bool, label: &str, patch: Value, context: Option<ReportContext>| {
        shapes.push((c3, label.to_owned(), shape(&patch), context));
    };
    add(
        false,
        "confirmed click carrying a value_readback receipt",
        confirmed(&[entry(
            "value_readback",
            "receipt",
            &json!({ "intended": "x", "value": "x" }),
        )]),
        ctx(CLICK, Platform::Windows),
    );
    add(
        false,
        "confirmed value verb whose only receipt is the barrier",
        confirmed(&[entry("barrier_consumed", "receipt", &none)]),
        ctx(VALUE, Platform::Windows),
    );
    add(
        false,
        "confirmed value verb whose read-back differs",
        confirmed(&[entry(
            "value_readback",
            "observation",
            &json!({ "intended": "x", "value": "x!" }),
        )]),
        ctx(VALUE, Platform::Macos),
    );
    add(
        false,
        "confirmed delivered_unverified",
        json!({ "effect": "confirmed", "evidence": [entry("barrier_consumed", "receipt", &none)] }),
        ctx(CLICK, Platform::Windows),
    );
    add(
        false,
        "barrier_consumed tagged observation",
        observed(&[entry("barrier_consumed", "observation", &none)]),
        None,
    );
    add(
        false,
        "xi2_raw_confirm tagged observation",
        observed(&[entry("xi2_raw_confirm", "observation", &none)]),
        None,
    );
    add(
        false,
        "value_readback equal to intended tagged observation",
        observed(&[entry(
            "value_readback",
            "observation",
            &json!({ "intended": "x", "value": "x" }),
        )]),
        None,
    );
    add(
        false,
        "observed Windows click with a consumed barrier",
        observed(&[
            entry("barrier_consumed", "receipt", &none),
            entry("focus_readback", "observation", &read),
        ]),
        ctx(CLICK, Platform::Windows),
    );
    add(
        false,
        "unverifiable value verb with a read-back equal to intended",
        json!({ "evidence": [entry("value_readback", "receipt", &json!({ "intended": "x", "value": "x" }))] }),
        ctx(VALUE, Platform::X11),
    );
    add(
        false,
        "suspected_noop with an observation entry",
        json!({ "effect": "suspected_noop", "evidence": [entry("settle_frame_diff", "observation", &none)] }),
        None,
    );
    add(
        false,
        "suspected_noop not delivered",
        json!({ "effect": "suspected_noop", "disposition": { "delivery": "not_delivered", "retry": "safe" } }),
        None,
    );
    add(
        false,
        "refused but delivered",
        json!({ "effect": "refused" }),
        None,
    );
    add(
        false,
        "delivered_verified without a receipt",
        json!({ "disposition": { "delivery": "delivered_verified", "retry": "unsafe" } }),
        None,
    );
    add(
        false,
        "delivered count above its total",
        json!({ "effect": "partial", "delivered": { "count": 3, "of": 2 } }),
        None,
    );
    add(
        false,
        "report without observation",
        json!({ "observation": null }),
        None,
    );
    add(
        false,
        "observation.untrustedText false",
        json!({ "observation": { "untrustedText": false } }),
        None,
    );
    add(
        false,
        "intended on a focus_readback",
        observed(&[entry(
            "focus_readback",
            "observation",
            &json!({ "intended": "a", "value": "b" }),
        )]),
        None,
    );
    add(
        false,
        "ax_notification without event",
        observed(&[entry("ax_notification", "observation", &none)]),
        None,
    );
    add(
        false,
        "event on a settle_frame_diff",
        json!({ "evidence": [entry("settle_frame_diff", "observation", &event)] }),
        None,
    );
    add(
        false,
        "a member the contract does not name",
        json!({ "verdict": "done" }),
        None,
    );
    add(
        false,
        "focusRestoration not_needed",
        json!({ "focusRestoration": "not_needed" }),
        None,
    );
    add(
        false,
        "effect outside the union",
        json!({ "effect": "done" }),
        None,
    );
    add(
        false,
        "evidence kind outside the union",
        json!({ "evidence": [entry("pixel_guess", "observation", &none)] }),
        None,
    );
    add(
        false,
        "xi2_raw_confirm on macOS",
        json!({ "disposition": { "delivery": "delivered_verified", "retry": "unsafe" }, "evidence": [entry("xi2_raw_confirm", "receipt", &none)] }),
        ctx(CLICK, Platform::Macos),
    );
    shapes
}
