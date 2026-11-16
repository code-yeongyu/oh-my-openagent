//! The v1 `audit` notification a consumer reads after every exec call (R56a: row 28's
//! channel). It mirrors the call as v1 wrote it; the hash-chained audit line of record stays
//! the session's. A text verb reports the length and a 16-hex digest, never the text.

use omo_computer_core::methods::{Effect, Method, MethodSpec};
use serde_json::{json, Value};
use omo_computer_session::audit::sha256_16;

use super::wire::{notification, WireError, INVALID_REQUEST, PARSE_ERROR};

const TEXT_MEMBERS: &[&str] = &["text", "value"];

/// The notification for one call, `None` for a call v1 never audited.
/// `secure`: the target is under the session's secure predicate, so the text keeps its length
/// only and a single printable key loses its name (the session audit's own redaction rule).
pub fn notify(spec: MethodSpec, params: &Value, outcome: &Result<Value, WireError>, secure: bool) -> Option<Value> {
    if spec.effect != Effect::Exec || is_unaudited(spec.method) || never_reached(outcome) {
        return None;
    }
    let control = matches!(
        spec.method,
        Method::ControlGrant | Method::ControlRevoke | Method::ControlAcquire
    );
    let text = if control { params["reason"].as_str() } else { text_of(params) };
    // `raiseWindow` names its window `windowId`; every other v1 exec names it `target`.
    let named = params.get("target").or_else(|| params.get("windowId")).cloned().unwrap_or(Value::Null);
    let target = if control { json!("control") } else { named };
    let delivery = match spec.method {
        _ if control => "control",
        Method::RaiseWindow | Method::WindowActivate | Method::WindowRaise => "foreground",
        _ => "background",
    };
    let error = outcome.as_ref().err();
    let mut audit = json!({
        "action": spec.name,
        "target": target,
        "delivery": params["delivery"].as_str().unwrap_or(delivery),
        "frameId": params.get("frameId").cloned().unwrap_or(Value::Null),
        "code": error.and_then(|e| e.data.as_ref()).map_or(Value::Null, |d| d["code"].clone()),
        "durationMs": 0,
        "focusRestored": Value::Null,
        "textLength": text.map_or(Value::Null, |t| json!(t.chars().count())),
        "textSha256": text.filter(|_| !secure).map_or(Value::Null, |t| json!(sha256_16(t.as_bytes()))),
        "keys": keys_on_wire(params.get("keys"), secure),
    });
    if let (Some(text), false) = (text, control) {
        audit["textDelivered"] = json!(delivered(text, error));
    }
    Some(notification("audit", audit))
}

/// A chord's names, except under the secure predicate one printable key (alone or with Shift)
/// would spell the typed character, so it is left out.
fn keys_on_wire(keys: Option<&Value>, secure: bool) -> Value {
    let Some(keys) = keys else { return Value::Null };
    let printable: Vec<&str> = keys
        .as_array()
        .map(|list| list.iter().filter_map(Value::as_str).filter(|key| !key.eq_ignore_ascii_case("shift")).collect())
        .unwrap_or_default();
    if secure && matches!(printable.as_slice(), [key] if key.chars().count() == 1) {
        return Value::Null;
    }
    keys.clone()
}

fn is_unaudited(method: Method) -> bool {
    matches!(
        method,
        Method::StopPathStart
            | Method::StopPathResume
            | Method::DesktopShutdown
            | Method::TestAdvanceClock
            | Method::DisplayRelease
            | Method::DisplayResume
    )
}

/// A call refused before it reached a session: a JSON-RPC protocol error (bad params, no such
/// method, the -32600..-32700 range) or `Closed` (no session open).
fn never_reached(outcome: &Result<Value, WireError>) -> bool {
    outcome.as_ref().err().is_some_and(|error| {
        (PARSE_ERROR..=INVALID_REQUEST).contains(&error.code)
            || error.data.as_ref().is_some_and(|data| data["code"] == "Closed")
    })
}

fn text_of(params: &Value) -> Option<&str> {
    TEXT_MEMBERS.iter().find_map(|name| params[*name].as_str())
}

/// Characters that landed: all on success, the refusal's `delivered.count` when it names one.
fn delivered(text: &str, error: Option<&WireError>) -> u64 {
    match error {
        None => u64::try_from(text.chars().count()).unwrap_or(u64::MAX),
        Some(error) => error
            .data
            .as_ref()
            .and_then(|data| data["delivered"]["count"].as_u64())
            .unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use omo_computer_core::methods::METHODS;

    use super::*;

    fn spec(method: Method) -> MethodSpec {
        METHODS[method as usize]
    }

    #[test]
    fn a_typed_text_is_digested_never_echoed() {
        let params = json!({"target": "101", "text": "hello"});
        let audit = notify(spec(Method::TypeText), &params, &Ok(Value::Null), false).expect("audited");
        assert_eq!(audit["params"]["textSha256"], json!("2cf24dba5fb0a30e"));
        assert_eq!((audit["params"]["textLength"].clone(), audit["params"]["textDelivered"].clone()), (json!(5), json!(5)));
        assert!(!audit.to_string().contains("hello"), "{audit}");
    }

    #[test]
    fn a_secure_target_keeps_the_length_and_drops_the_digest_and_the_single_key() {
        let typed = json!({"target": "101", "text": "hunter2"});
        let plain = notify(spec(Method::TypeText), &typed, &Ok(Value::Null), false).expect("audited");
        let secure = notify(spec(Method::TypeText), &typed, &Ok(Value::Null), true).expect("audited");
        assert!(plain["params"]["textSha256"].is_string(), "{plain}");
        assert_eq!((&secure["params"]["textSha256"], &secure["params"]["textLength"]), (&Value::Null, &json!(7)), "{secure}");
        let chord = json!({"target": "101", "keys": ["shift", "a"]});
        let keyed = notify(spec(Method::KeyChord), &chord, &Ok(Value::Null), true).expect("audited");
        assert_eq!(keyed["params"]["keys"], Value::Null, "{keyed}");
        let set = notify(spec(Method::AxSetValue), &json!({"ref": "e2", "value": "hunter2"}), &Ok(Value::Null), true).expect("audited");
        assert_eq!((&set["params"]["textSha256"], &set["params"]["textLength"]), (&Value::Null, &json!(7)), "{set}");
        assert!(!set.to_string().contains("hunter2"), "no plaintext: {set}");
        let named = notify(spec(Method::KeyChord), &json!({"target": "101", "keys": ["cmd", "q"]}), &Ok(Value::Null), true).expect("audited");
        assert_eq!(named["params"]["keys"], json!(["cmd", "q"]), "{named}");
    }

    #[test]
    fn raise_window_audits_its_window_id_as_the_target() {
        let refused = Err(WireError::bare(omo_computer_core::error::EngineCode::StopPathUnavailable));
        let audit = notify(spec(Method::RaiseWindow), &json!({"windowId": "101"}), &refused, false).expect("audited");
        assert_eq!(audit["params"]["target"], "101", "{audit}");
    }

    #[test]
    fn a_call_that_never_reached_a_session_is_not_audited() {
        let bad = Err(WireError::invalid_params(&serde_json::from_str::<u8>("x").expect_err("bad")));
        assert!(notify(spec(Method::Click), &json!({}), &bad, false).is_none());
        let closed = Err(WireError::bare(omo_computer_core::error::EngineCode::Closed));
        assert!(notify(spec(Method::Click), &json!({}), &closed, false).is_none());
    }

    #[test]
    fn reads_and_the_stop_verbs_are_not_audited() {
        assert!(notify(spec(Method::Capture), &json!({}), &Ok(Value::Null), false).is_none());
        assert!(notify(spec(Method::StopPathStart), &json!({}), &Ok(Value::Null), false).is_none());
    }

    #[test]
    fn a_refused_call_carries_its_code() {
        let refused = WireError::bare(omo_computer_core::error::EngineCode::Suspended);
        let audit = notify(spec(Method::Click), &json!({"target": "desktop"}), &Err(refused), false).expect("audited");
        assert_eq!(audit["params"]["code"], json!("Suspended"));
        assert_eq!(audit["params"]["delivery"], json!("background"));
    }
}
