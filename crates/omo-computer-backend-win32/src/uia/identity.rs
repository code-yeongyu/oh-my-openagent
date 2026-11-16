//! Ref identity on Windows is the element's `RuntimeId` (`GetRuntimeId` as a cached property):
//! one stable [`NativeObject`] per id, which the session's re-identification compares (row 18:
//! 0 matches -> `StaleRef`, 2 or more -> `AmbiguousTarget`).

use omo_computer_core::ax::NativeObject;

/// The [`NativeObject`] of a `RuntimeId`: FNV-1a over its length and every part, so order,
/// length and sign all distinguish.
#[must_use]
pub fn native_object(runtime_id: &[i32]) -> NativeObject {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut hash = OFFSET;
    let len = u64::try_from(runtime_id.len()).unwrap_or(u64::MAX);
    for byte in len
        .to_le_bytes()
        .into_iter()
        .chain(runtime_id.iter().flat_map(|part| part.to_le_bytes()))
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(PRIME);
    }
    NativeObject(hash)
}
