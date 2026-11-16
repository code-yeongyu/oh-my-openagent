//! The exposure bridge: which caller may reach which row of the method table. The spawning
//! host on `--stdio` reaches public and host-only rows; a bridge (`--oneshot`, `--mcp`) reaches
//! public rows only; a test-only row exists only while the fake clock seam is installed and
//! never crosses a bridge. Everything else is the v1 rejection, decided before any dispatch.

use omo_computer_core::methods::{Exposure, Method, MethodSpec, METHODS};

use super::wire::WireError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Peer {
    /// The host that spawned this engine over `--stdio`.
    Host,
    /// `--oneshot` and the `--mcp` shim.
    Bridge,
}

/// The row `name` names, when `peer` may call it.
///
/// # Errors
/// The v1 rejection: `unknown`, `hostOnly` or `testOnly`.
pub fn admit(peer: Peer, name: &str, test_clock: bool) -> Result<MethodSpec, WireError> {
    let method = Method::from_name(name).ok_or_else(|| WireError::rejected("unknown"))?;
    let spec = METHODS[method as usize];
    match (spec.exposure, peer) {
        (Exposure::Public, _) | (Exposure::HostOnly(_), Peer::Host) => Ok(spec),
        (Exposure::HostOnly(_), Peer::Bridge) => Err(WireError::rejected("hostOnly")),
        (Exposure::TestOnly, Peer::Host) if test_clock => Ok(spec),
        (Exposure::TestOnly, _) => Err(WireError::rejected("testOnly")),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn reason(outcome: Result<MethodSpec, WireError>) -> serde_json::Value {
        outcome.err().and_then(|error| error.data).unwrap_or_default()["reason"].clone()
    }

    #[test]
    fn a_bridge_reaches_public_rows_only() {
        assert!(admit(Peer::Bridge, "capture", true).is_ok());
        assert_eq!(reason(admit(Peer::Bridge, "stopPath.resume", true)), json!("hostOnly"));
        assert_eq!(reason(admit(Peer::Bridge, "$/test.advanceClock", true)), json!("testOnly"));
        assert_eq!(reason(admit(Peer::Bridge, "reset", true)), json!("unknown"));
    }

    #[test]
    fn the_host_reaches_test_rows_only_under_the_fake_clock() {
        assert!(admit(Peer::Host, "stopPath.resume", false).is_ok());
        assert!(admit(Peer::Host, "$/test.advanceClock", true).is_ok());
        assert_eq!(reason(admit(Peer::Host, "$/test.advanceClock", false)), json!("testOnly"));
    }
}
