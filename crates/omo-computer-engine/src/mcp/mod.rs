//! `--mcp`: the engine's own router behind an MCP stdio shim (d-arch.md 'Host adapters'). The
//! shim is the host: its session is the bridge session, its tools are the public rows, and its
//! consent view is the NARROWER of the `--tier` request and the hand's `consent.json` (G2).

mod call;
mod catalog;
pub mod tier;

use std::io::{self, BufRead, Write};

use serde_json::{json, Value};

use crate::bridge::BridgeSession;
use crate::executor::framing::{parse, Line};
use crate::router::{reply, WireError, INVALID_PARAMS};
use catalog::Catalog;

const PROTOCOL_VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

pub struct Server {
    catalog: Catalog,
    bridge: BridgeSession,
}

impl Server {
    #[must_use]
    pub fn new(bridge: BridgeSession) -> Self {
        Self {
            catalog: Catalog::new(),
            bridge,
        }
    }

    /// Serves until the client closes stdin.
    ///
    /// # Errors
    /// Reading a request or writing a reply failed.
    pub fn run(mut self, input: impl BufRead, output: &mut impl Write) -> io::Result<()> {
        for line in input.split(b'\n') {
            let message = match parse(&line?) {
                Line::Blank | Line::Notification { .. } => continue,
                Line::Invalid(id, error) => reply(&id, &Err(error)),
                Line::Request { id, method, params } => reply(&id, &self.answer(&method, &params)),
            };
            writeln!(output, "{message}")?;
            output.flush()?;
        }
        Ok(())
    }

    fn answer(&mut self, method: &str, params: &Value) -> Result<Value, WireError> {
        match method {
            "initialize" => Ok(initialize(params)),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({ "tools": self.catalog.tools() })),
            "tools/call" => self.call(params),
            _ => Err(WireError::rejected("unknown")),
        }
    }

    fn call(&mut self, params: &Value) -> Result<Value, WireError> {
        let name = params["name"].as_str().unwrap_or_default();
        let Some(method) = self.catalog.method(name).map(str::to_owned) else {
            return Err(WireError::new(INVALID_PARAMS, &format!("unknown tool: {name}"), None));
        };
        let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
        Ok(call::tool_result(&self.bridge.call(&method, arguments)))
    }
}

fn initialize(params: &Value) -> Value {
    let requested = params["protocolVersion"].as_str();
    let version = requested
        .filter(|version| PROTOCOL_VERSIONS.contains(version))
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": "omo-computer-engine", "version": env!("CARGO_PKG_VERSION") },
    })
}
