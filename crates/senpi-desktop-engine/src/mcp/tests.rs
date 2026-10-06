use std::cell::RefCell;
use std::io;
use std::rc::Rc;

use serde_json::{json, Value};

use super::Server;

type Sent = Rc<RefCell<Vec<Value>>>;

fn server(
    allow_host_relay_only_stop: bool,
    reply: Value,
) -> (Server<impl FnMut(&Value) -> io::Result<Value>>, Sent) {
    let sent: Sent = Rc::default();
    let log = Rc::clone(&sent);
    let exchange = move |request: &Value| {
        log.borrow_mut().push(request.clone());
        Ok(reply.clone())
    };
    (Server::new(allow_host_relay_only_stop, exchange), sent)
}

fn ask(server: &mut Server<impl FnMut(&Value) -> io::Result<Value>>, request: &Value) -> Value {
    let line = server
        .answer(&request.to_string())
        .expect("a request gets a reply");
    serde_json::from_str(&line).expect("reply is JSON")
}

fn tool_names(server: &mut Server<impl FnMut(&Value) -> io::Result<Value>>) -> Vec<String> {
    let reply = ask(
        server,
        &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
    );
    reply["result"]["tools"]
        .as_array()
        .expect("tools array")
        .iter()
        .map(|tool| tool["name"].as_str().expect("name").to_owned())
        .collect()
}

fn call(name: &str, arguments: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": name, "arguments": arguments } })
}

#[test]
fn initialize_echoes_a_supported_protocol_version_and_offers_tools() {
    let (mut server, _) = server(false, json!({}));
    let reply = ask(
        &mut server,
        &json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }),
    );
    assert_eq!(reply["result"]["protocolVersion"], "2025-03-26");
    assert_eq!(reply["result"]["capabilities"]["tools"]["listChanged"], false);
}

#[test]
fn tools_are_the_public_methods_plus_stop_and_never_resume_or_host_controls() {
    let (mut server, _) = server(false, json!({}));
    let names = tool_names(&mut server);
    for present in [
        "desktop_capture",
        "desktop_click",
        "desktop_stop",
        "desktop_stopPath_status",
    ] {
        assert!(
            names.contains(&present.to_owned()),
            "{present} missing from {names:?}"
        );
    }
    for absent in [
        "desktop_stopPath_resume",
        "desktop_stopPath_start",
        "desktop_session_open",
        "desktop_stopPath_heartbeat",
    ] {
        assert!(!names.contains(&absent.to_owned()), "{absent} must not be listed");
    }
}

#[test]
fn heartbeat_is_listed_only_when_the_host_relay_is_the_allowed_stop_path() {
    let (mut server, sent) = server(true, json!({ "jsonrpc": "2.0", "id": 1, "result": {} }));
    assert!(tool_names(&mut server).contains(&"desktop_stopPath_heartbeat".to_owned()));
    ask(&mut server, &call("desktop_stopPath_heartbeat", json!({})));
    assert_eq!(sent.borrow()[0]["method"], "stopPath.heartbeat");
}

#[test]
fn every_tool_input_schema_is_an_object_schema() {
    let (mut server, _) = server(false, json!({}));
    let reply = ask(
        &mut server,
        &json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" }),
    );
    for tool in reply["result"]["tools"].as_array().expect("tools") {
        assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
    }
}

#[test]
fn an_unknown_or_unlisted_tool_is_a_json_rpc_error_and_never_reaches_the_daemon() {
    let (mut server, sent) = server(false, json!({}));
    for name in ["desktop_nope", "desktop_stopPath_resume", "desktop_session_open"] {
        let reply = ask(&mut server, &call(name, json!({})));
        assert_eq!(reply["error"]["code"], -32602, "{name}: {reply}");
    }
    assert!(sent.borrow().is_empty());
}

#[test]
fn stop_forwards_an_api_stop_to_the_daemon() {
    let (mut server, sent) = server(
        false,
        json!({ "jsonrpc": "2.0", "id": 1, "result": { "status": "suspended" } }),
    );
    let reply = ask(&mut server, &call("desktop_stop", json!({})));
    assert_eq!(sent.borrow()[0]["method"], "stopPath.stop");
    assert_eq!(sent.borrow()[0]["params"], json!({ "source": "api" }));
    assert_eq!(reply["result"]["structuredContent"]["status"], "suspended");
}

#[test]
fn an_inline_capture_becomes_an_image_block_and_metadata_without_the_bytes() {
    let result = json!({ "mode": "inline", "data": "iVBORw0KGgo=", "mimeType": "image/png", "width": 2, "frameId": "f1" });
    let (mut server, _) = server(false, json!({ "jsonrpc": "2.0", "id": 1, "result": result }));
    let reply = ask(&mut server, &call("desktop_capture", json!({})));
    let content = &reply["result"]["content"];
    assert_eq!(
        content[0],
        json!({ "type": "image", "data": "iVBORw0KGgo=", "mimeType": "image/png" })
    );
    assert_eq!(reply["result"]["structuredContent"]["frameId"], "f1");
    assert!(reply["result"]["structuredContent"].get("data").is_none());
}

#[test]
fn an_engine_error_is_an_error_tool_result_carrying_the_engine_error_unchanged() {
    let error =
        json!({ "code": -32014, "message": "no live stop path", "data": { "code": "StopPathUnavailable" } });
    let (mut server, _) = server(false, json!({ "jsonrpc": "2.0", "id": 1, "error": error }));
    let reply = ask(&mut server, &call("desktop_click", json!({ "x": 1, "y": 1 })));
    assert_eq!(reply["result"]["isError"], true);
    let text: Value = serde_json::from_str(reply["result"]["content"][0]["text"].as_str().expect("text"))
        .expect("error JSON");
    assert_eq!(text, error);
}

#[test]
fn notifications_get_no_reply_and_unknown_methods_are_rejected() {
    let (mut server, _) = server(false, json!({}));
    assert!(server
        .answer(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
        .is_none());
    let reply = ask(
        &mut server,
        &json!({ "jsonrpc": "2.0", "id": 3, "method": "resources/list" }),
    );
    assert_eq!(reply["error"]["code"], -32601);
}
