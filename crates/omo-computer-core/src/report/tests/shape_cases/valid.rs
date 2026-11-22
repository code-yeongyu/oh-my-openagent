//! The valid controls: each is accepted and its disposition is a member of `ALL`.

use serde_json::{json, Value};

use super::{confirmed, ctx, entry, observed, shape, CLICK, VALUE};
use crate::report::{Platform, ReportContext};

pub(in crate::report::tests) fn valid_shapes() -> Vec<(&'static str, Value, Option<ReportContext>)>
{
    let none = json!({});
    let verified = json!({ "delivery": "delivered_verified", "retry": "unsafe" });
    vec![
        (
            "unverifiable populated-tree click",
            shape(&json!({})),
            ctx(CLICK, Platform::Macos),
        ),
        (
            "confirmed Windows click",
            shape(&confirmed(&[entry("barrier_consumed", "receipt", &none)])),
            ctx(CLICK, Platform::Windows),
        ),
        (
            "confirmed value verb",
            shape(&confirmed(&[entry(
                "value_readback",
                "receipt",
                &json!({ "intended": "x", "value": "x", "baseline": "" }),
            )])),
            ctx(VALUE, Platform::Wayland),
        ),
        (
            "observed value verb",
            shape(&observed(&[entry(
                "value_readback",
                "observation",
                &json!({ "intended": "x", "value": "x!", "baseline": "" }),
            )])),
            ctx(VALUE, Platform::X11),
        ),
        (
            "observed click",
            shape(&observed(&[entry(
                "focus_readback",
                "observation",
                &json!({ "value": "a", "baseline": "a" }),
            )])),
            ctx(CLICK, Platform::Macos),
        ),
        (
            "observed X11 MPX click",
            shape(
                &json!({ "effect": "observed", "disposition": verified, "evidence": [entry("xi2_raw_confirm", "receipt", &none), entry("ax_notification", "observation", &json!({ "event": "window:create" }))] }),
            ),
            ctx(CLICK, Platform::X11),
        ),
        (
            "suspected no-op",
            shape(&json!({ "effect": "suspected_noop" })),
            ctx(CLICK, Platform::Wayland),
        ),
        (
            "suspected no-op under MPX",
            shape(
                &json!({ "effect": "suspected_noop", "disposition": verified, "evidence": [entry("xi2_raw_confirm", "receipt", &none)] }),
            ),
            ctx(CLICK, Platform::X11),
        ),
        (
            "unverifiable with settle observations",
            shape(
                &json!({ "evidence": [entry("settle_frame_diff", "observation", &none), entry("ax_change", "observation", &none)] }),
            ),
            ctx(CLICK, Platform::Windows),
        ),
        (
            "partial with counts",
            shape(&json!({ "effect": "partial", "delivered": { "count": 2, "of": 5 } })),
            ctx(VALUE, Platform::Macos),
        ),
        (
            "refused",
            shape(
                &json!({ "effect": "refused", "disposition": { "delivery": "not_delivered", "retry": "safe" } }),
            ),
            ctx(CLICK, Platform::Macos),
        ),
        (
            "no_change kept in the union",
            shape(&json!({ "effect": "no_change" })),
            None,
        ),
        (
            "background click with focus untouched",
            shape(&json!({ "focusRestoration": "untouched", "auditIds": ["01M6"] })),
            ctx(CLICK, Platform::Macos),
        ),
    ]
}
