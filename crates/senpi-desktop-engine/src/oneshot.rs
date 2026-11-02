//! `--oneshot`: bunshin's sidecar contract. One JSON-RPC line in on stdin,
//! one reply line out on stdout, the request id echoed verbatim. Methods are
//! `desktop.<method>`; host-only engine methods never cross this bridge,
//! except `desktop.stop` (`stopPath.stop {source:"api"}`) and
//! `desktop.stopPath.status`, and `stopPath.resume` never does.

use std::io::{self, BufRead, BufReader, Write};

use senpi_desktop_core::methods::{Exposure, Method};
use senpi_desktop_core::protocol::{MethodRejection, RequestId};
use serde_json::{json, Map, Value};

use crate::rpc::{failure_line, Failure};

pub const METHOD_PREFIX: &str = "desktop.";

/// What `desktop.<name>` asks of the daemon, or why the bridge refuses it.
pub fn translate(method: &str, params: Value) -> Result<(String, Value), Failure> {
    let Some(name) = method.strip_prefix(METHOD_PREFIX) else {
        return Err(Failure::Rejected(MethodRejection::Unknown));
    };
    match name {
        "stop" => Ok(("stopPath.stop".to_owned(), json!({ "source": "api" }))),
        "stopPath.status" => Ok(("stopPath.status".to_owned(), params)),
        _ => match Method::from_name(name).map(|method| method.spec().exposure) {
            Some(Exposure::Public) => Ok((name.to_owned(), params)),
            Some(Exposure::HostOnly) => Err(Failure::Rejected(MethodRejection::HostOnly)),
            Some(Exposure::TestOnly) => Err(Failure::Rejected(MethodRejection::TestOnly)),
            None => Err(Failure::Rejected(MethodRejection::Unknown)),
        },
    }
}

/// Reads the request line, forwards it through `exchange`, and writes the
/// reply line with the caller's id.
///
/// # Errors
/// stdin/stdout failed; a daemon failure is answered as a JSON-RPC error.
pub fn run(exchange: impl FnOnce(&Value) -> io::Result<Value>) -> io::Result<()> {
    let mut line = String::new();
    BufReader::new(io::stdin().lock()).read_line(&mut line)?;
    let reply = answer(line.trim(), exchange);
    let mut out = io::stdout().lock();
    writeln!(out, "{reply}")?;
    out.flush()
}

fn answer(line: &str, exchange: impl FnOnce(&Value) -> io::Result<Value>) -> String {
    let request: Map<String, Value> = match serde_json::from_str(line) {
        Ok(Value::Object(request)) => request,
        Ok(_) => {
            return failure_line(
                None,
                Failure::InvalidRequest("request is not an object".to_owned()),
            )
        }
        Err(error) => return failure_line(None, Failure::Parse(format!("parse error: {error}"))),
    };
    let id = request.get("id").cloned().unwrap_or(Value::Null);
    let request_id = serde_json::from_value::<RequestId>(id.clone()).ok();
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return failure_line(
            request_id,
            Failure::InvalidRequest("request has no method".to_owned()),
        );
    };
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    let (engine_method, params) = match translate(method, params) {
        Ok(translated) => translated,
        Err(failure) => return failure_line(request_id, failure),
    };
    let forwarded = json!({ "jsonrpc": "2.0", "id": 1, "method": engine_method, "params": params });
    match exchange(&forwarded) {
        Ok(Value::Object(mut reply)) => {
            reply.insert("id".to_owned(), id);
            Value::Object(reply).to_string()
        }
        Ok(other) => failure_line(
            request_id,
            Failure::InvalidRequest(format!("daemon replied {other}")),
        ),
        Err(error) => failure_line(
            request_id,
            Failure::Engine(senpi_desktop_core::error::DesktopError::internal(format!(
                "the desktop daemon is unreachable: {error}"
            ))),
        ),
    }
}

#[cfg(test)]
#[path = "oneshot_tests.rs"]
mod tests;
