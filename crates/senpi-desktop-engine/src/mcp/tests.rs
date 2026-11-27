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
    assert_eq!(
        reply["result"]["capabilities"]["tools"]["listChanged"],
        false
    );
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
        "desktop_control_state",
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
        "desktop_control_grant",
        "desktop_control_revoke",
    ] {
        assert!(
            !names.contains(&absent.to_owned()),
            "{absent} must not be listed"
        );
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
    for name in [
        "desktop_nope",
        "desktop_stopPath_resume",
        "desktop_session_open",
    ] {
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
    let (mut server, _) = server(
        false,
        json!({ "jsonrpc": "2.0", "id": 1, "result": result }),
    );
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
    let error = json!({ "code": -32014, "message": "no live stop path", "data": { "code": "StopPathUnavailable" } });
    let (mut server, _) = server(false, json!({ "jsonrpc": "2.0", "id": 1, "error": error }));
    let reply = ask(
        &mut server,
        &call("desktop_click", json!({ "x": 1, "y": 1 })),
    );
    assert_eq!(reply["result"]["isError"], true);
    let text: Value = serde_json::from_str(
        reply["result"]["content"][0]["text"]
            .as_str()
            .expect("text"),
    )
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

fn modern(method: &str) -> Value {
    json!({
        "jsonrpc": "2.0", "id": "modern", "method": method,
        "params": { "_meta": {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {}
        } }
    })
}

fn assert_modern(result: &Value) {
    assert_eq!(result["resultType"], "complete");
    assert_eq!(
        result["_meta"]["io.modelcontextprotocol/serverInfo"],
        json!({ "name": "senpi-desktop-engine", "version": env!("CARGO_PKG_VERSION") })
    );
}

#[test]
fn modern_discovery_and_lists_work_without_initialize_and_include_cache_hints() {
    let (mut server, sent) = server(false, json!({}));
    let discovery = ask(&mut server, &modern("server/discover"));
    let result = &discovery["result"];
    assert_modern(result);
    assert_eq!(
        result["supportedVersions"],
        json!(["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"])
    );
    assert_eq!(result["capabilities"], json!({ "tools": {} }));
    assert_eq!(result["ttlMs"], 0);
    assert_eq!(result["cacheScope"], "public");
    let list = ask(&mut server, &modern("tools/list"));
    assert_modern(&list["result"]);
    assert_eq!(list["result"]["ttlMs"], 0);
    assert_eq!(list["result"]["cacheScope"], "public");
    assert!(list["result"]["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .any(|tool| tool["name"] == "desktop_capture"));
    assert!(sent.borrow().is_empty());
}

#[test]
fn modern_tool_success_and_engine_errors_keep_their_content_and_gain_envelopes() {
    for reply in [
        json!({ "result": { "status": "suspended" } }),
        json!({ "error": { "code": -32014, "message": "no live stop path" } }),
    ] {
        let (mut server, sent) = server(false, reply.clone());
        let mut request = modern("tools/call");
        request["params"]["name"] = json!("desktop_stop");
        request["params"]["arguments"] = json!({});
        let response = ask(&mut server, &request);
        assert_modern(&response["result"]);
        assert_eq!(sent.borrow().len(), 1);
        if reply.get("error").is_some() {
            assert_eq!(response["result"]["isError"], true);
            let error: Value = serde_json::from_str(
                response["result"]["content"][0]["text"]
                    .as_str()
                    .expect("error text"),
            )
            .expect("error JSON");
            assert_eq!(error, reply["error"]);
        } else {
            assert_eq!(response["result"]["structuredContent"], reply["result"]);
        }
    }
}

#[test]
fn unsupported_modern_versions_are_rejected_before_any_daemon_exchange() {
    let (mut server, sent) = server(false, json!({}));
    for version in [
        "1900-01-01",
        "2099-01-01",
        "2025-06-18",
        "2025-03-26",
        "2024-11-05",
    ] {
        for method in ["server/discover", "tools/list", "tools/call"] {
            let mut request = modern(method);
            request["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"] = json!(version);
            request["params"]["name"] = json!("desktop_stop");
            let reply = ask(&mut server, &request);
            assert_eq!(reply["id"], "modern");
            assert_eq!(reply["error"]["code"], -32022, "{request}: {reply}");
            assert_eq!(
                reply["error"]["data"],
                json!({
                    "supported": ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"],
                    "requested": version
                })
            );
        }
    }
    assert!(sent.borrow().is_empty());
    assert_modern(&ask(&mut server, &modern("tools/list"))["result"]);
}

#[test]
fn malformed_modern_metadata_is_invalid_params_before_dispatch() {
    let (mut server, sent) = server(false, json!({}));
    for meta in [
        Value::Null,
        json!([]),
        json!("bad"),
        json!({ "io.modelcontextprotocol/protocolVersion": "2026-07-28" }),
        json!({ "io.modelcontextprotocol/clientCapabilities": {} }),
        json!({ "io.modelcontextprotocol/clientInfo": {} }),
        json!({ "io.modelcontextprotocol/protocolVersion": 42, "io.modelcontextprotocol/clientCapabilities": {} }),
        json!({ "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": null }),
        json!({ "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": [] }),
    ] {
        for method in ["server/discover", "tools/list", "tools/call"] {
            let mut request = modern(method);
            request["params"]["_meta"] = meta.clone();
            request["params"]["name"] = json!("desktop_stop");
            let reply = ask(&mut server, &request);
            assert_eq!(reply["error"]["code"], -32602, "{request}: {reply}");
        }
    }
    let reply = ask(
        &mut server,
        &json!({ "id": 1, "method": "server/discover" }),
    );
    assert_eq!(reply["error"]["code"], -32602);
    assert!(sent.borrow().is_empty());
}

#[test]
fn idless_notifications_never_reply_or_dispatch_even_with_invalid_metadata() {
    let (mut server, sent) = server(false, json!({}));
    for method in [
        "initialize",
        "ping",
        "notifications/initialized",
        "tools/list",
        "tools/call",
        "server/discover",
        "unknown",
    ] {
        for meta in [
            modern(method)["params"]["_meta"].clone(),
            json!(null),
            json!({ "io.modelcontextprotocol/protocolVersion": "2099-01-01",
                "io.modelcontextprotocol/clientCapabilities": {} }),
        ] {
            let request = json!({ "jsonrpc": "2.0", "method": method,
                "params": { "_meta": meta, "name": "desktop_stop" } });
            assert!(server.answer(&request.to_string()).is_none(), "{request}");
        }
    }
    assert!(sent.borrow().is_empty());
}

#[test]
fn modern_requests_do_not_change_legacy_negotiation_or_later_requests() {
    let (mut server, _) = server(false, json!({ "result": { "status": "suspended" } }));
    for version in [
        "2025-06-18",
        "2025-03-26",
        "2024-11-05",
        "2026-07-28",
        "2099-01-01",
    ] {
        assert_modern(&ask(&mut server, &modern("tools/list"))["result"]);
        let init = ask(
            &mut server,
            &json!({ "id": 0, "method": "initialize", "params": { "protocolVersion": version } }),
        );
        let negotiated = if super::PROTOCOL_VERSIONS.contains(&version) {
            version
        } else {
            "2025-06-18"
        };
        assert_eq!(
            init["result"],
            json!({
                "protocolVersion": negotiated,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "senpi-desktop-engine", "version": env!("CARGO_PKG_VERSION") }
            })
        );
        assert_eq!(
            ask(&mut server, &json!({ "id": 1, "method": "ping" }))["result"],
            json!({})
        );
        for request in [
            json!({ "id": 2, "method": "tools/list", "params": { "_meta": { "custom/trace": "legacy" } } }),
            call("desktop_stop", json!({})),
        ] {
            let reply = ask(&mut server, &request);
            assert!(reply["result"].is_object());
            assert!(reply["result"].get("resultType").is_none());
            assert!(reply["result"].get("_meta").is_none());
            assert!(reply["result"].get("ttlMs").is_none());
        }
    }
}

#[test]
fn modern_requests_reject_removed_lifecycle_methods_and_keep_rpc_errors_bare() {
    let (mut server, sent) = server(false, json!({}));
    for method in ["initialize", "ping", "notifications/initialized", "unknown"] {
        let reply = ask(&mut server, &modern(method));
        assert_eq!(reply["error"]["code"], -32601);
        assert!(reply.get("result").is_none());
    }
    let mut request = modern("tools/call");
    request["params"]["name"] = json!("desktop_nope");
    let reply = ask(&mut server, &request);
    assert_eq!(reply["error"]["code"], -32602);
    assert!(reply.get("result").is_none());
    assert!(sent.borrow().is_empty());
}
