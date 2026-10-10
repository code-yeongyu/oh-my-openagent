use std::cell::RefCell;
use std::io;

use senpi_desktop_core::protocol::MethodRejection;
use serde_json::{json, Value};

use super::{answer, translate};
use crate::rpc::Failure;

fn rejected(method: &str) -> Option<MethodRejection> {
    match translate(method, json!({})) {
        Err(Failure::Rejected(reason)) => Some(reason),
        _ => None,
    }
}

#[test]
fn host_only_methods_are_refused_by_the_bridge() {
    for method in [
        "desktop.session.open",
        "desktop.session.close",
        "desktop.stopPath.start",
        "desktop.stopPath.heartbeat",
        "desktop.stopPath.resume",
    ] {
        assert_eq!(rejected(method), Some(MethodRejection::HostOnly), "{method}");
    }
}

#[test]
fn stop_and_status_are_the_only_forwarded_stop_path_calls() {
    assert_eq!(
        translate("desktop.stop", json!({})).ok(),
        Some(("stopPath.stop".to_owned(), json!({ "source": "api" })))
    );
    assert_eq!(
        translate("desktop.stopPath.status", json!({}))
            .ok()
            .map(|(method, _)| method),
        Some("stopPath.status".to_owned())
    );
}

#[test]
fn public_methods_forward_without_the_prefix_and_others_are_unknown() {
    assert_eq!(
        translate("desktop.click", json!({"x": 1})).ok(),
        Some(("click".to_owned(), json!({"x": 1})))
    );
    assert_eq!(rejected("click"), Some(MethodRejection::Unknown));
    assert_eq!(rejected("desktop.nope"), Some(MethodRejection::Unknown));
}

#[test]
fn the_reply_echoes_a_string_id_verbatim() {
    let seen = RefCell::new(None);
    let reply = answer(
        r#"{"jsonrpc":"2.0","id":"1","method":"desktop.capabilities"}"#,
        |forwarded| {
            *seen.borrow_mut() = Some(forwarded.clone());
            Ok(json!({"jsonrpc": "2.0", "id": 1, "result": {"backend": "fake"}}))
        },
    );
    let reply: Value = serde_json::from_str(&reply).expect("reply is JSON");
    assert_eq!(
        (reply["id"].clone(), reply["result"]["backend"].clone()),
        (json!("1"), json!("fake"))
    );
    assert_eq!(
        seen.borrow().as_ref().map(|value| value["method"].clone()),
        Some(json!("capabilities"))
    );
}

#[test]
fn a_refused_method_never_reaches_the_daemon() {
    let reply = answer(
        r#"{"jsonrpc":"2.0","id":7,"method":"desktop.stopPath.resume","params":{"token":"x"}}"#,
        |_| Err(io::Error::other("the daemon must not be contacted")),
    );
    let reply: Value = serde_json::from_str(&reply).expect("reply is JSON");
    assert_eq!(
        (
            reply["id"].clone(),
            reply["error"]["code"].clone(),
            reply["error"]["data"]["reason"].clone()
        ),
        (json!(7), json!(-32601), json!("hostOnly"))
    );
}
