//! Gate 2: which stop path admits exec. A deaf listener refuses under any policy and is never
//! answered by the relay; then `host_relay_not_allowed`, `heartbeat_stale`, `no_listener`.

use omo_computer_core::capabilities::DeafReason;

/// The transport a session was opened over; it sets the default stop policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Local,
    Relay,
    Bunshin,
}

/// `StopPolicy{allowHostRelayOnly}`, read at `session.open`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StopPolicy {
    pub allow_host_relay_only: bool,
}

impl StopPolicy {
    /// `true` on relay and bunshin hands (no local stop UI), `false` on the local loop.
    #[must_use]
    pub const fn default_for(transport: Transport) -> Self {
        let _ = transport;
        Self {
            allow_host_relay_only: false,
        }
    }

    /// The policy a `session.open` sets: its `allowHostRelayOnlyStop`, else the transport's default.
    #[must_use]
    pub const fn read(transport: Transport, requested: Option<bool>) -> Self {
        match requested {
            Some(allow_host_relay_only) => Self {
                allow_host_relay_only,
            },
            None => Self::default_for(transport),
        }
    }
}

/// The engine's own (global) listener, as gate 2 reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalListener {
    /// No listener: none armed, or no seat to arm one on.
    None,
    /// Heard within the freshness window.
    Fresh,
    /// Its liveness lapsed with a re-arm pending.
    Stale { since_ms: u64 },
    /// It exists and cannot hear (Secure Input, no portal, no raw events, a parked listener).
    Deaf { reason: Option<DeafReason> },
}

/// The host relay's heartbeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayBeat {
    Absent,
    Fresh,
    Stale,
}

/// Everything gate 2 decides on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StopPathView {
    pub global: GlobalListener,
    pub relay: RelayBeat,
    pub policy: StopPolicy,
}

/// The stop path that admitted the call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopPathKind {
    Global,
    HostRelay,
}

impl StopPathKind {
    #[must_use]
    pub const fn wire(self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::HostRelay => "host-relay",
        }
    }
}

verdicts! {
    /// Gate 2's refusals, in precedence order.
    StopPathFailure [4] {
        Deaf => StopPathUnavailable(Deaf),
        HostRelayNotAllowed => StopPathUnavailable(HostRelayNotAllowed),
        HeartbeatStale => StopPathUnavailable(HeartbeatStale),
        NoListener => StopPathUnavailable(NoListener),
    }
}

impl StopPathView {
    /// The stop path that admits exec: a fresh global listener first; the relay only when the
    /// global listener is absent or stale AND the policy allows it; a deaf listener never.
    ///
    /// # Errors
    /// The first refusal of the precedence `deaf` -> `host_relay_not_allowed` ->
    /// `heartbeat_stale` -> `no_listener`.
    pub const fn admit(&self) -> Result<StopPathKind, StopPathFailure> {
        // RED: the pick order is not built yet.
        Ok(StopPathKind::Global)
    }
}

#[cfg(test)]
mod tests;
