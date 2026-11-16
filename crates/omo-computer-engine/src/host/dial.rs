//! One `hand.status` round trip to the host's local API (G1 item 2): NDJSON JSON-RPC 2.0, empty
//! params, a 1,000 ms budget that covers the connect and the reply. A refused or absent address is not proof that no host is live -
//! the caller has already read the latch file - so only `NoListener` lets a run go `file_only`;
//! a listener that does not answer in time, or answers garbage, is latch SET.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::sync::mpsc;
use std::time::{Duration, Instant};

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
        HostAddress::Socket(path) => {
            let path = path.clone();
            connect_within(BUDGET, move || UnixStream::connect(path)).map(Some)
        }
        HostAddress::Endpoint(_) => Ok(None),
    }
}

/// `connect` bounded by `budget`: `std` has no connect timeout for Unix sockets, so the connect
/// runs on its own thread and a stall past the budget answers `TimedOut` (the thread is left to
/// finish or fail on its own; its stream, if any, is dropped).
fn connect_within(
    budget: Duration,
    connect: impl FnOnce() -> std::io::Result<UnixStream> + Send + 'static,
) -> std::io::Result<UnixStream> {
    let (done, outcome) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = done.send(connect());
    });
    outcome
        .recv_timeout(budget)
        .unwrap_or_else(|_| Err(std::io::ErrorKind::TimedOut.into()))
}

fn no_listener(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused
    )
}

pub fn dial(address: &HostAddress, identity: &dyn ListenerIdentity) -> Dialed {
    let started = Instant::now();
    let stream = match connect(address) {
        Ok(Some(stream)) => stream,
        Ok(None) => return Dialed::NoListener,
        Err(error) if no_listener(&error) => return Dialed::NoListener,
        Err(error) => return Dialed::Unanswered(format!("host_api_connect:{error}")),
    };
    let identity = identity.check(&stream);
    match exchange(&stream, BUDGET.saturating_sub(started.elapsed()).max(Duration::from_millis(1))) {
        Ok(reply) => Dialed::Answered { identity, reply },
        Err(why) => Dialed::Unanswered(why),
    }
}

/// The `hand.status` round trip within `remaining`: the 1,000 ms budget covers connect and reply.
fn exchange(stream: &UnixStream, remaining: Duration) -> Result<Value, String> {
    stream
        .set_read_timeout(Some(remaining))
        .and_then(|()| stream.set_write_timeout(Some(remaining)))
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

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{connect_within, BUDGET};

    /// Review L2 of #13373: a connect that never completes (a squatter with a full backlog) is
    /// cut at the budget and read as unanswered, never waited on.
    #[test]
    fn a_connect_that_stalls_is_cut_at_the_budget() {
        let started = Instant::now();
        let outcome = connect_within(BUDGET, || {
            std::thread::sleep(Duration::from_secs(5));
            Err(std::io::ErrorKind::ConnectionRefused.into())
        });
        let error = outcome.expect_err("cut at the budget");
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < BUDGET + Duration::from_millis(500), "{:?}", started.elapsed());
    }
}
