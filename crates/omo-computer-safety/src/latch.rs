//! The stop latch's reasons: gate 1's `Suspended{reason}`.

verdicts! {
    /// Why the latch is set.
    SuspendReason [6] {
        /// A marker was present (or unreadable) when the engine started.
        StopMarker => Suspended(StopMarker),
        /// The physical stop chord, heard by the listen-only listener.
        Hotkey => Suspended(Hotkey),
        /// A stop relayed by the session's host.
        HostRelay => Suspended(HostRelay),
        /// `stopPath.stop` from a caller.
        Api => Suspended(Api),
        /// A fleet stop.
        Fleet => Suspended(Fleet),
        /// The hand tool host's latch is set (`hand.status{latch}` at `session.open`).
        HostLatch => Suspended(HostLatch),
    }
}

impl SuspendReason {
    /// The reason a `stopPath.stop{source}` call latches with. A wire caller never latches
    /// `hotkey`: only the physical listener does, so a posted chord never arms the stop.
    #[must_use]
    pub fn from_stop_source(source: Option<&str>) -> Self {
        match source {
            Some("host-relay" | "host_relay") => Self::HostRelay,
            Some("fleet") => Self::Fleet,
            _ => Self::Api,
        }
    }
}
