//! `engine.hello`: the first frame on every connection (amendment A8, design row C2).
//!
//! Protocol version stays the string `"1"`. The ABI string is `omo-computer/1` and is
//! compared by major. `generation`, `limits` and `machineId` are additive members of
//! protocol 1 that the imported v1 corpus does not list (see `ORACLE-DELTAS.tsv`).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The wire protocol version, a string, unchanged from v1.
pub const PROTOCOL_VERSION: &str = "1";

/// The ABI line the engine reports and a host compares by major.
pub const ABI: &str = "omo-computer/1";

/// The opt-in features this engine advertises in `hello.features`.
pub const FEATURES: &[&str] = &["action-report"];

/// The size ceilings a host must respect on this connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Limits {
    pub max_request_bytes: u32,
    pub max_response_bytes: u32,
    pub max_frame_bytes: u32,
}

impl Limits {
    /// A local connection: 1 MiB requests, 4 MiB responses, 5,000,000-byte frames.
    #[must_use]
    pub const fn local() -> Self {
        Self {
            max_request_bytes: 1 << 20,
            max_response_bytes: 4 << 20,
            max_frame_bytes: 5_000_000,
        }
    }

    /// A bunshin inline connection: responses capped at 65,536 bytes.
    #[must_use]
    pub const fn bunshin_inline() -> Self {
        Self {
            max_response_bytes: 65_536,
            ..Self::local()
        }
    }
}

/// The `engine.hello` reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hello {
    pub protocol_version: String,
    pub engine_version: String,
    pub build_sha: String,
    pub abi: String,
    pub features: Vec<String>,
    /// Incremented on every engine restart; a reply from another generation is quarantined.
    pub generation: u64,
    pub limits: Limits,
    /// sha256-16 of the lock-file identity and the uid: one id per user and machine.
    pub machine_id: String,
}

impl Hello {
    /// The reply of an engine of `engine_version` built at `build_sha`.
    #[must_use]
    pub fn new(
        engine_version: &str,
        build_sha: &str,
        generation: u64,
        limits: Limits,
        machine_id: String,
    ) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION.to_owned(),
            engine_version: engine_version.to_owned(),
            build_sha: build_sha.to_owned(),
            abi: ABI.to_owned(),
            features: FEATURES
                .iter()
                .map(|feature| (*feature).to_owned())
                .collect(),
            generation,
            limits,
            machine_id,
        }
    }
}

/// The per-uid machine identity: the first 16 hex digits of
/// `sha256(lock-file identity || 0x00 || uid as decimal)`.
#[must_use]
pub fn machine_id(lock_file_identity: &[u8], uid: u32) -> String {
    let mut hasher = Sha256::new();
    hasher.update(lock_file_identity);
    hasher.update([0u8]);
    hasher.update(uid.to_string().as_bytes());
    hasher
        .finalize()
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The major of an ABI line `<name>/<major>[.<minor>]`, or `None` for a malformed line.
#[must_use]
pub fn abi_major(abi: &str) -> Option<(&str, u32)> {
    let (name, version) = abi.split_once('/')?;
    let major = version.split('.').next()?.parse().ok()?;
    (!name.is_empty()).then_some((name, major))
}

/// Whether a peer reporting `peer_abi` may talk to this engine: same name, same major.
#[must_use]
pub fn abi_compatible(peer_abi: &str) -> bool {
    matches!((abi_major(ABI), abi_major(peer_abi)), (Some(ours), Some(theirs)) if ours == theirs)
}
