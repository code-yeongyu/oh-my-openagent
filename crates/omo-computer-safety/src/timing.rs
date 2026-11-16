//! The stop path's clock constants.

/// The interval a live stop path beats at.
pub const HEARTBEAT_INTERVAL_MS: u64 = 500;

/// A beat older than this is stale: the stop path no longer admits exec.
pub const HEARTBEAT_FRESH_MS: u64 = 2_000;

/// The bounded re-arm ladder of a listener the OS disabled; exhausted, the listener parks.
pub const RE_ARM_LADDER_MS: [u64; 5] = [250, 500, 1_000, 2_000, 4_000];

/// How long a stop commit waits for every hold to release before the engine exits 1.
pub const STOP_RELEASE_BUDGET_MS: u64 = 1_000;
