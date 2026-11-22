//! The wire shapes the validation tests run: the invalid shapes (13 dispositions plus the
//! design-row C3 list and the rest) and the valid controls.

mod c3;
mod other;
mod valid;

use serde_json::{json, Map, Value};

use crate::report::{Delivery, Disposition, Platform, ReportContext, Retry, VerbClass};

pub(in crate::report::tests) use valid::valid_shapes;

/// `(design row C3 names it, label, report, context)`.
pub(super) type Shape = (bool, String, Value, Option<ReportContext>);

pub(super) const CLICK: VerbClass = VerbClass::Action;
pub(super) const VALUE: VerbClass = VerbClass::Value;

pub(super) fn ctx(verb: VerbClass, platform: Platform) -> Option<ReportContext> {
    Some(ReportContext::new(verb, Some(platform)))
}

pub(super) fn shape(patch: &Value) -> Value {
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

pub(super) fn entry(kind: &str, class: &str, extra: &Value) -> Value {
    let mut entry = Map::new();
    entry.insert("kind".to_owned(), json!(kind));
    entry.insert("class".to_owned(), json!(class));
    if let Some(extra) = extra.as_object() {
        entry.extend(extra.clone());
    }
    Value::Object(entry)
}

pub(super) fn confirmed(evidence: &[Value]) -> Value {
    json!({ "effect": "confirmed", "disposition": { "delivery": "delivered_verified", "retry": "unsafe" }, "evidence": evidence })
}

pub(super) fn observed(evidence: &[Value]) -> Value {
    json!({ "effect": "observed", "evidence": evidence })
}

/// Every invalid shape: the 13 invalid dispositions inside an otherwise valid report, the
/// design-row C3 list, and the rest.
pub(super) fn invalid_shapes() -> Vec<Shape> {
    let mut shapes = Vec::new();
    for delivery in Delivery::ALL {
        for retry in Retry::ALL
            .into_iter()
            .filter(|retry| Disposition::new(delivery, *retry).is_err())
        {
            let patch =
                json!({ "disposition": { "delivery": delivery.wire(), "retry": retry.wire() } });
            let label = format!("disposition {}/{}", delivery.wire(), retry.wire());
            shapes.push((false, label, shape(&patch), None));
        }
    }
    shapes.extend(c3::shapes());
    shapes.extend(other::shapes());
    shapes
}
