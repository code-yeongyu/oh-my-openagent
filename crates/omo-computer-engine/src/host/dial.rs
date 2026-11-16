//! One `hand.status` round trip to the host's local API (G1 item 2): NDJSON JSON-RPC 2.0, empty
//! params, a 1,000 ms budget. A refused or absent address is not proof that no host is live -
//! the caller has already read the latch file - so only `NoListener` lets a run go `file_only`;
//! a listener that does not answer in time, or answers garbage, is latch SET.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

use omo_computer_core::host_paths::HostAddress;
use serde_json::Value;

use super::identity::{Identity, ListenerIdentity};

const BUDGET: Duration = Duration::from_millis(1_000);
const MAX_REPLY_BYTES: u64 = 64 * 1024;
const REQUEST: &str = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"hand.status\",\"params\":{}}\n";

pub enum Dialed {
    NoListener,
    /// Connected, but no valid reply within the budget; names why.
    Unanswered(String),
    Answered { identity: Identity, reply: Value },
}

fn connect(address: &HostAddress) -> std::io::Result<Option<UnixStream>> {
    match address {
        HostAddress::Socket(path) => UnixStream::connect(path).map(Some),
        HostAddress::Abstract(name) => abstract_connect(name).map(Some),
        HostAddress::Endpoint(_) => Ok(None),
    }
}

#[cfg(target_os = "linux")]
fn abstract_connect(name: &str) -> std::io::Result<UnixStream> {
    use std::os::linux::net::SocketAddrExt;
    let addr = std::os::unix::net::SocketAddr::from_abstract_name(name.as_bytes())?;
    UnixStream::connect_addr(&addr)
}

#[cfg(not(target_os = "linux"))]
fn abstract_connect(_name: &str) -> std::io::Result<UnixStream> {
    Err(std::io::ErrorKind::Unsupported.into())
}

fn no_listener(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
    )
}

pub fn dial(address: &HostAddress, identity: &dyn ListenerIdentity) -> Dialed {
    let stream = match connect(address) {
        Ok(Some(stream)) => stream,
        Ok(None) => return Dialed::NoListener,
        Err(error) if no_listener(&error) => return Dialed::NoListener,
        Err(error) => return Dialed::Unanswered(format!("host_api_connect:{error}")),
    };
    let identity = identity.check(&stream);
    match exchange(&stream) {
        Ok(reply) => Dialed::Answered { identity, reply },
        Err(why) => Dialed::Unanswered(why),
    }
}

fn exchange(stream: &UnixStream) -> Result<Value, String> {
    stream
        .set_read_timeout(Some(BUDGET))
        .and_then(|()| stream.set_write_timeout(Some(BUDGET)))
        .map_err(|e| format!("host_api_timeout_setup:{e}"))?;
    let mut writer = stream;
    writer
        .write_all(REQUEST.as_bytes())
        .and_then(|()| writer.flush())
        .map_err(|e| format!("host_api_write:{e}"))?;
    let mut line = String::new();
    BufReader::new(stream.take(MAX_REPLY_BYTES))
        .read_line(&mut line)
        .map_err(|e| format!("host_api_read:{e}"))?;
    let reply: Value = serde_json::from_str(line.trim()).map_err(|_| "host_api_unparsed".to_owned())?;
    match reply.get("result") {
        Some(result) if result.is_object() => Ok(result.clone()),
        _ => Err("host_api_no_result".to_owned()),
    }
}
