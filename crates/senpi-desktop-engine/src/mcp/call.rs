//! `tools/call`: the tool's `desktop.<method>` goes through the same bridge
//! policy as `--oneshot` to the same daemon, and the engine reply becomes an
//! MCP tool result. An engine error is a tool result with `isError: true`
//! carrying the engine's error object unchanged.

use std::io;

use serde_json::{json, Map, Value};

use crate::oneshot::translate;
use crate::rpc::Failure;

const HEARTBEAT_TOOL_METHOD: &str = "desktop.stopPath.heartbeat";

/// Forwards one call and shapes the reply; `Err` is a JSON-RPC-level failure.
pub fn call_tool(
    method: &str,
    arguments: Value,
    exchange: &mut impl FnMut(&Value) -> io::Result<Value>,
) -> Result<Value, Failure> {
    let (engine_method, params) = if method == HEARTBEAT_TOOL_METHOD {
        ("stopPath.heartbeat".to_owned(), arguments)
    } else {
        translate(method, arguments)?
    };
    let request = json!({ "jsonrpc": "2.0", "id": 1, "method": engine_method, "params": params });
    let reply = exchange(&request).map_err(|error| {
        Failure::Engine(senpi_desktop_core::error::DesktopError::internal(format!(
            "the desktop daemon is unreachable: {error}"
        )))
    })?;
    Ok(match (reply.get("result"), reply.get("error")) {
        (_, Some(error)) => json!({ "content": [text(error)], "isError": true }),
        (Some(result), None) => tool_result(result),
        (None, None) => json!({ "content": [text(&reply)], "isError": true }),
    })
}

/// An inline capture becomes an image block plus its metadata; every other
/// result is one text block and, for objects, `structuredContent`.
fn tool_result(result: &Value) -> Value {
    let Some(object) = result.as_object() else {
        return json!({ "content": [text(result)] });
    };
    let image = match (
        object.get("data").and_then(Value::as_str),
        object.get("mimeType").and_then(Value::as_str),
    ) {
        (Some(data), Some(mime)) => Some(json!({ "type": "image", "data": data, "mimeType": mime })),
        _ => None,
    };
    let Some(image) = image else {
        return json!({ "content": [text(result)], "structuredContent": result });
    };
    let metadata: Map<String, Value> = object
        .iter()
        .filter(|(key, _)| key.as_str() != "data")
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let metadata = Value::Object(metadata);
    json!({ "content": [image, text(&metadata)], "structuredContent": metadata })
}

fn text(value: &Value) -> Value {
    json!({ "type": "text", "text": value.to_string() })
}
