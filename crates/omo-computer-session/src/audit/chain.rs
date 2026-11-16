//! The per-segment hash chain: `lineHash` is the first 16 hex of SHA-256 over the line's
//! JSON without `prev` and `lineHash`; `prev` is the previous line's `lineHash` in the
//! writer's segment, `"meta"` on the first line after `audit.meta`.

use serde_json::Value;
use sha2::{Digest, Sha256};

/// The first 16 hex digits of SHA-256.
#[must_use]
pub fn sha256_16(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The `lineHash` of a line, recomputed from its JSON (`prev` and `lineHash` ignored).
#[must_use]
pub fn line_hash(line: &Value) -> String {
    let mut body = line.clone();
    if let Some(object) = body.as_object_mut() {
        object.remove("prev");
        object.remove("lineHash");
    }
    sha256_16(body.to_string().as_bytes())
}
