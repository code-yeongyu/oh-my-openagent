//! The invalid shapes design row C3 names.

use serde_json::{json, Value};

use super::{confirmed, ctx, entry, observed, shape, Shape, CLICK};
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
        true,
        "confirmed with empty evidence",
        confirmed(&[]),
        ctx(CLICK, Platform::Windows),
    );
    for (kind, extra) in [
        ("value_readback", &read),
        ("focus_readback", &read),
        ("menu_readback", &read),
        ("ax_notification", &event),
        ("settle_frame_diff", &none),
        ("ax_change", &none),
    ] {
        add(
            true,
            &format!("confirmed click whose evidence is a {kind} observation only"),
            confirmed(&[entry(kind, "observation", extra)]),
            ctx(CLICK, Platform::Windows),
        );
        if kind != "value_readback" {
            add(
                true,
                &format!("{kind} tagged receipt"),
                observed(&[entry(kind, "receipt", extra)]),
                None,
            );
        }
    }
    add(
        true,
        "value_readback without intended tagged receipt",
        observed(&[entry("value_readback", "receipt", &read)]),
        None,
    );
    add(
        true,
        "value_readback whose value differs from intended tagged receipt",
        observed(&[entry(
            "value_readback",
            "receipt",
            &json!({ "intended": "x", "value": "x!", "baseline": "" }),
        )]),
        None,
    );
    add(
        true,
        "observed without an observation entry",
        observed(&[]),
        None,
    );
    add(
        true,
        "observed whose only entry is settle-window change",
        observed(&[entry("settle_frame_diff", "observation", &none)]),
        None,
    );
    add(
        true,
        "confirmed whose only receipt is xi2_raw_confirm",
        confirmed(&[entry("xi2_raw_confirm", "receipt", &none)]),
        ctx(CLICK, Platform::X11),
    );
    for platform in [Platform::Macos, Platform::X11, Platform::Wayland] {
        add(
            true,
            &format!("confirmed click from the {platform:?} fake"),
            confirmed(&[entry("barrier_consumed", "receipt", &none)]),
            ctx(CLICK, platform),
        );
    }
    add(
        true,
        "partial without delivered counts",
        json!({ "effect": "partial" }),
        None,
    );
    shapes
}
