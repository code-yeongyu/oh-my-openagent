//! R60a: an `effect:"refused"` report carries `reason` and `nothingSent: true`, and no other
//! report does; the reason enum is exactly the three pinned reasons (d-sdk-skill.md:555).

use serde_json::json;

use crate::report::{ActionReport, RefusalReason};

#[test]
fn the_refusal_reason_enum_is_exactly_the_three_pinned_reasons() {
    let wire: Vec<_> = [RefusalReason::SecureFocus, RefusalReason::ConcealedClipboard, RefusalReason::SecretNoClipboardRoute]
        .into_iter()
        .map(|reason| serde_json::to_value(reason).expect("reason"))
        .collect();
    assert_eq!(wire, [json!("secure_focus"), json!("concealed_clipboard"), json!("secret_no_clipboard_route")]);
    assert!(serde_json::from_value::<RefusalReason>(json!("other")).is_err(), "a closed enum");
}

fn report(extra: serde_json::Value) -> Result<ActionReport, serde_json::Error> {
    let mut value = json!({
        "disposition": {"delivery": "not_delivered", "retry": "after_user"},
        "effect": "refused",
        "route": "background_pid",
        "auditIds": [],
        "evidence": [],
        "observation": { "untrustedText": true }
    });
    for (key, item) in extra.as_object().expect("extra").clone() {
        value.as_object_mut().expect("object").insert(key, item);
    }
    serde_json::from_value(value)
}

#[test]
fn reason_and_nothing_sent_are_present_exactly_when_refused() {
    assert!(report(json!({"reason": "secure_focus", "nothingSent": true})).is_ok(), "refused with both");
    assert!(report(json!({})).is_err(), "refused without them");
    assert!(report(json!({"reason": "secure_focus"})).is_err(), "refused without nothingSent");
    assert!(report(json!({"reason": "secure_focus", "nothingSent": false})).is_err(), "nothingSent is the literal true");
    assert!(
        report(json!({"effect": "unverifiable", "disposition": {"delivery": "delivered_unverified", "retry": "unsafe"}, "reason": "secure_focus", "nothingSent": true})).is_err(),
        "a report that is not refused carries neither"
    );
}
