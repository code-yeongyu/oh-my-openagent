//! Wire shapes: every invalid shape is refused, every valid control is accepted, and an
//! accepted report's disposition is a member of `ALL`.

use serde_json::{json, Map, Value};

use super::wire_check;
use crate::report::{Delivery, Disposition, Platform, ReportContext, Retry, VerbClass};

const CLICK: VerbClass = VerbClass::Action;
const VALUE: VerbClass = VerbClass::Value;

fn ctx(verb: VerbClass, platform: Platform) -> Option<ReportContext> {
    Some(ReportContext::new(verb, Some(platform)))
}

fn shape(patch: &Value) -> Value {
    let mut report = json!({
        "disposition": { "delivery": "delivered_unverified", "retry": "unsafe" },
        "effect": "unverifiable",
        "route": "background_pid",
        "auditIds": [],
        "evidence": [],
        "observation": { "untrustedText": true }
    });
    if let (Some(base), Some(changes)) = (report.as_object_mut(), patch.as_object()) {
        for (member, value) in changes {
            if value.is_null() {
                base.remove(member);
            } else {
                base.insert(member.clone(), value.clone());
            }
        }
    }
    report
}

fn entry(kind: &str, class: &str, extra: &Value) -> Value {
    let mut entry = Map::new();
    entry.insert("kind".to_owned(), json!(kind));
    entry.insert("class".to_owned(), json!(class));
    if let Some(extra) = extra.as_object() {
        entry.extend(extra.clone());
    }
    Value::Object(entry)
}

fn confirmed(evidence: &[Value]) -> Value {
    json!({ "effect": "confirmed", "disposition": { "delivery": "delivered_verified", "retry": "unsafe" }, "evidence": evidence })
}

fn observed(evidence: &[Value]) -> Value {
    json!({ "effect": "observed", "evidence": evidence })
}

/// `(design row C3 names it, label, report, context)`.
fn invalid_shapes() -> Vec<(bool, String, Value, Option<ReportContext>)> {
    let none = json!({});
    let read = json!({ "value": "b", "baseline": "a" });
    let event = json!({ "event": "AXSheetCreated" });
    let mut shapes = Vec::new();
    for delivery in Delivery::ALL {
        for retry in Retry::ALL.into_iter().filter(|retry| Disposition::new(delivery, *retry).is_err()) {
            let label = format!("disposition {}/{}", delivery.wire(), retry.wire());
            shapes.push((false, label, json!({ "disposition": { "delivery": delivery.wire(), "retry": retry.wire() } }), None));
        }
    }
    let mut add = |c3: bool, label: &str, patch: Value, context: Option<ReportContext>| {
        shapes.push((c3, label.to_owned(), shape(&patch), context));
    };
    add(true, "confirmed with empty evidence", confirmed(&[]), ctx(CLICK, Platform::Windows));
    for (kind, extra) in [("value_readback", &read), ("focus_readback", &read), ("menu_readback", &read), ("ax_notification", &event), ("settle_frame_diff", &none), ("ax_change", &none)] {
        add(true, &format!("confirmed click whose evidence is a {kind} observation only"), confirmed(&[entry(kind, "observation", extra)]), ctx(CLICK, Platform::Windows));
        if kind != "value_readback" {
            add(true, &format!("{kind} tagged receipt"), observed(&[entry(kind, "receipt", extra)]), None);
        }
    }
    add(true, "value_readback without intended tagged receipt", observed(&[entry("value_readback", "receipt", &read)]), None);
    add(true, "value_readback whose value differs from intended tagged receipt", observed(&[entry("value_readback", "receipt", &json!({ "intended": "x", "value": "x!", "baseline": "" }))]), None);
    add(true, "observed without an observation entry", observed(&[]), None);
    add(true, "observed whose only entry is settle-window change", observed(&[entry("settle_frame_diff", "observation", &none)]), None);
    add(true, "confirmed whose only receipt is xi2_raw_confirm", confirmed(&[entry("xi2_raw_confirm", "receipt", &none)]), ctx(CLICK, Platform::X11));
    for platform in [Platform::Macos, Platform::X11, Platform::Wayland] {
        add(true, &format!("confirmed click from the {platform:?} fake"), confirmed(&[entry("barrier_consumed", "receipt", &none)]), ctx(CLICK, platform));
    }
    add(true, "partial without delivered counts", json!({ "effect": "partial" }), None);
    add(false, "confirmed click carrying a value_readback receipt", confirmed(&[entry("value_readback", "receipt", &json!({ "intended": "x", "value": "x" }))]), ctx(CLICK, Platform::Windows));
    add(false, "confirmed value verb whose only receipt is the barrier", confirmed(&[entry("barrier_consumed", "receipt", &none)]), ctx(VALUE, Platform::Windows));
    add(false, "confirmed value verb whose read-back differs", confirmed(&[entry("value_readback", "observation", &json!({ "intended": "x", "value": "x!" }))]), ctx(VALUE, Platform::Macos));
    add(false, "confirmed delivered_unverified", json!({ "effect": "confirmed", "evidence": [entry("barrier_consumed", "receipt", &none)] }), ctx(CLICK, Platform::Windows));
    add(false, "barrier_consumed tagged observation", observed(&[entry("barrier_consumed", "observation", &none)]), None);
    add(false, "xi2_raw_confirm tagged observation", observed(&[entry("xi2_raw_confirm", "observation", &none)]), None);
    add(false, "value_readback equal to intended tagged observation", observed(&[entry("value_readback", "observation", &json!({ "intended": "x", "value": "x" }))]), None);
    add(false, "observed Windows click with a consumed barrier", observed(&[entry("barrier_consumed", "receipt", &none), entry("focus_readback", "observation", &read)]), ctx(CLICK, Platform::Windows));
    add(false, "unverifiable value verb with a read-back equal to intended", json!({ "evidence": [entry("value_readback", "receipt", &json!({ "intended": "x", "value": "x" }))] }), ctx(VALUE, Platform::X11));
    add(false, "suspected_noop with an observation entry", json!({ "effect": "suspected_noop", "evidence": [entry("settle_frame_diff", "observation", &none)] }), None);
    add(false, "suspected_noop not delivered", json!({ "effect": "suspected_noop", "disposition": { "delivery": "not_delivered", "retry": "safe" } }), None);
    add(false, "refused but delivered", json!({ "effect": "refused" }), None);
    add(false, "delivered_verified without a receipt", json!({ "disposition": { "delivery": "delivered_verified", "retry": "unsafe" } }), None);
    add(false, "delivered count above its total", json!({ "effect": "partial", "delivered": { "count": 3, "of": 2 } }), None);
    add(false, "report without observation", json!({ "observation": null }), None);
    add(false, "observation.untrustedText false", json!({ "observation": { "untrustedText": false } }), None);
    add(false, "intended on a focus_readback", observed(&[entry("focus_readback", "observation", &json!({ "intended": "a", "value": "b" }))]), None);
    add(false, "ax_notification without event", observed(&[entry("ax_notification", "observation", &none)]), None);
    add(false, "event on a settle_frame_diff", json!({ "evidence": [entry("settle_frame_diff", "observation", &event)] }), None);
    add(false, "a member the contract does not name", json!({ "verdict": "done" }), None);
    add(false, "focusRestoration not_needed", json!({ "focusRestoration": "not_needed" }), None);
    add(false, "effect outside the union", json!({ "effect": "done" }), None);
    add(false, "evidence kind outside the union", json!({ "evidence": [entry("pixel_guess", "observation", &none)] }), None);
    add(false, "xi2_raw_confirm on macOS", json!({ "disposition": { "delivery": "delivered_verified", "retry": "unsafe" }, "evidence": [entry("xi2_raw_confirm", "receipt", &none)] }), ctx(CLICK, Platform::Macos));
    shapes
}

fn valid_shapes() -> Vec<(&'static str, Value, Option<ReportContext>)> {
    let none = json!({});
    let verified = json!({ "delivery": "delivered_verified", "retry": "unsafe" });
    vec![
        ("unverifiable populated-tree click", shape(&json!({})), ctx(CLICK, Platform::Macos)),
        ("confirmed Windows click", shape(&confirmed(&[entry("barrier_consumed", "receipt", &none)])), ctx(CLICK, Platform::Windows)),
        ("confirmed value verb", shape(&confirmed(&[entry("value_readback", "receipt", &json!({ "intended": "x", "value": "x", "baseline": "" }))])), ctx(VALUE, Platform::Wayland)),
        ("observed value verb", shape(&observed(&[entry("value_readback", "observation", &json!({ "intended": "x", "value": "x!", "baseline": "" }))])), ctx(VALUE, Platform::X11)),
        ("observed click", shape(&observed(&[entry("focus_readback", "observation", &json!({ "value": "a", "baseline": "a" }))])), ctx(CLICK, Platform::Macos)),
        ("observed X11 MPX click", shape(&json!({ "effect": "observed", "disposition": verified, "evidence": [entry("xi2_raw_confirm", "receipt", &none), entry("ax_notification", "observation", &json!({ "event": "window:create" }))] })), ctx(CLICK, Platform::X11)),
        ("suspected no-op", shape(&json!({ "effect": "suspected_noop" })), ctx(CLICK, Platform::Wayland)),
        ("suspected no-op under MPX", shape(&json!({ "effect": "suspected_noop", "disposition": verified, "evidence": [entry("xi2_raw_confirm", "receipt", &none)] })), ctx(CLICK, Platform::X11)),
        ("unverifiable with settle observations", shape(&json!({ "evidence": [entry("settle_frame_diff", "observation", &none), entry("ax_change", "observation", &none)] })), ctx(CLICK, Platform::Windows)),
        ("partial with counts", shape(&json!({ "effect": "partial", "delivered": { "count": 2, "of": 5 } })), ctx(VALUE, Platform::Macos)),
        ("refused", shape(&json!({ "effect": "refused", "disposition": { "delivery": "not_delivered", "retry": "safe" } })), ctx(CLICK, Platform::Macos)),
        ("no_change kept in the union", shape(&json!({ "effect": "no_change" })), None),
        ("background click with focus untouched", shape(&json!({ "focusRestoration": "untouched", "auditIds": ["01M6"] })), ctx(CLICK, Platform::Macos)),
    ]
}

fn run(only_c3: bool) -> usize {
    let mut refused = 0;
    for (c3, label, report, context) in invalid_shapes() {
        if only_c3 && !c3 {
            continue;
        }
        let checked = wire_check(&report, context);
        println!("REJECT {label}: {:?}", checked.as_ref().err());
        assert!(checked.is_err(), "accepted an invalid shape: {label}");
        refused += 1;
    }
    for (label, report, context) in valid_shapes() {
        let checked = wire_check(&report, context);
        println!("ACCEPT {label}: {:?}", checked.as_ref().err());
        let disposition = checked.unwrap_or_else(|error| panic!("refused a valid shape {label}: {error}")).disposition();
        assert!(Disposition::ALL.contains(&disposition), "{label}: disposition outside ALL");
    }
    refused
}

#[test]
fn disposition_wire_shapes() {
    let refused = run(true);
    println!("{refused} design-row C3 shapes refused");
    assert!(refused >= 20, "the C3 list shrank: {refused}");
}

#[test]
fn action_report_wire_validation() {
    let refused = run(false);
    println!("{refused} invalid shapes refused");
    assert!(refused >= 40, "fewer than 40 invalid shapes: {refused}");
}
