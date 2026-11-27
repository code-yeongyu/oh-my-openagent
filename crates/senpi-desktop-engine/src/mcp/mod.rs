//! `--mcp`: an MCP stdio server (tools capability) over the same `--serve`
//! daemon `--oneshot` uses. It is a persistent `--oneshot`: the bridge policy,
//! the daemon's own session and stop paths, and the user's `--resume` are
//! unchanged, and no input path exists that JSON-RPC clients do not also take.

mod call;
mod catalog;

use std::io::{self, BufRead, Write};

use senpi_desktop_core::protocol::{MethodRejection, RequestId};
use serde_json::{json, Value};

use crate::rpc::{failure_line, reply_line, Failure};
use catalog::Catalog;

const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MODERN_PROTOCOL_VERSION: &str = "2026-07-28";
const SUPPORTED_VERSIONS: [&str; 4] = [
    MODERN_PROTOCOL_VERSION,
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
];
const VERSION_META_KEY: &str = "io.modelcontextprotocol/protocolVersion";
const CAPABILITIES_META_KEY: &str = "io.modelcontextprotocol/clientCapabilities";
const CLIENT_INFO_META_KEY: &str = "io.modelcontextprotocol/clientInfo";

pub struct Server<X> {
    catalog: Catalog,
    exchange: X,
}

impl<X: FnMut(&Value) -> io::Result<Value>> Server<X> {
    pub fn new(allow_host_relay_only_stop: bool, exchange: X) -> Self {
        let schema = senpi_desktop_core::engine_schema();
        Self {
            catalog: Catalog::new(&schema, allow_host_relay_only_stop),
            exchange,
        }
    }

    /// Serves requests line by line until the client closes stdin.
    ///
    /// # Errors
    /// Reading stdin or writing stdout failed.
    pub fn run(mut self, input: impl BufRead, mut output: impl Write) -> io::Result<()> {
        for line in input.lines() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            if let Some(reply) = self.answer(&line) {
                writeln!(output, "{reply}")?;
                output.flush()?;
            }
        }
        Ok(())
    }

    /// The reply line for one message; notifications get none.
    pub fn answer(&mut self, line: &str) -> Option<String> {
        let message: Value = match serde_json::from_str(line) {
            Ok(message) => message,
            Err(error) => {
                return Some(failure_line(
                    None,
                    Failure::Parse(format!("parse error: {error}")),
                ))
            }
        };
        let method = message.get("method").and_then(Value::as_str);
        let id = message.get("id").cloned()?;
        let Ok(request_id) = serde_json::from_value::<RequestId>(id) else {
            return Some(failure_line(
                None,
                Failure::InvalidRequest("invalid id".to_owned()),
            ));
        };
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
        let modern = match modern_request(&params, method == Some("server/discover")) {
            Ok(modern) => modern,
            Err(error) => {
                return Some(
                    json!({ "jsonrpc": "2.0", "id": request_id, "error": error }).to_string(),
                )
            }
        };
        let outcome = match method {
            Some("server/discover") => Ok(json!({
                "supportedVersions": SUPPORTED_VERSIONS,
                "capabilities": { "tools": {} },
                "ttlMs": 0,
                "cacheScope": "public",
            })),
            Some("initialize") if !modern => Ok(initialize(&params)),
            Some("ping") if !modern => Ok(json!({})),
            Some("tools/list") => {
                let mut result = json!({ "tools": self.catalog.tools() });
                if modern {
                    result["ttlMs"] = json!(0);
                    result["cacheScope"] = json!("public");
                }
                Ok(result)
            }
            Some("tools/call") => self.call(&params),
            Some(_) => Err(Failure::Rejected(MethodRejection::Unknown)),
            None => Err(Failure::InvalidRequest("request has no method".to_owned())),
        };
        let outcome = outcome.map(|mut result| {
            if modern {
                result["resultType"] = json!("complete");
                result["_meta"] = json!({
                    "io.modelcontextprotocol/serverInfo": {
                        "name": "senpi-desktop-engine", "version": env!("CARGO_PKG_VERSION")
                    }
                });
            }
            result
        });
        Some(reply_line(request_id, outcome))
    }

    fn call(&mut self, params: &Value) -> Result<Value, Failure> {
        let name = params
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let Some(method) = self.catalog.method(name).map(str::to_owned) else {
            return Err(Failure::InvalidParams(format!("unknown tool: {name}")));
        };
        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));
        call::call_tool(&method, arguments, &mut self.exchange)
    }
}

/// The era is local to this request; unrelated legacy metadata remains valid.
fn modern_request(params: &Value, discovery: bool) -> Result<bool, Value> {
    let meta = params.get("_meta");
    let has_protocol_meta = meta.is_some_and(|meta| {
        !meta.is_object()
            || [
                VERSION_META_KEY,
                CAPABILITIES_META_KEY,
                CLIENT_INFO_META_KEY,
            ]
            .iter()
            .any(|key| meta.get(key).is_some())
    });
    if !discovery && !has_protocol_meta {
        return Ok(false);
    }
    let version = meta
        .and_then(|meta| meta.get(VERSION_META_KEY))
        .and_then(Value::as_str);
    let capabilities = meta.and_then(|meta| meta.get(CAPABILITIES_META_KEY));
    let Some(version) = version.filter(|_| capabilities.is_some_and(Value::is_object)) else {
        return Err(json!({
            "code": -32602,
            "message": "Protocol version and client capabilities are required in params._meta",
        }));
    };
    if version != MODERN_PROTOCOL_VERSION {
        return Err(json!({
            "code": -32022,
            "message": "Unsupported protocol version",
            "data": { "supported": SUPPORTED_VERSIONS, "requested": version },
        }));
    }
    Ok(true)
}

fn initialize(params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = requested
        .filter(|version| PROTOCOL_VERSIONS.contains(version))
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "senpi-desktop-engine", "version": env!("CARGO_PKG_VERSION") },
    })
}

#[cfg(test)]
mod tests;
