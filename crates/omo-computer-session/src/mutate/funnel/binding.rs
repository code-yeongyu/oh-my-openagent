//! How an admitted call's audit line records the binding of its consent entry (A-IS-61 Q5).

use super::super::record::Record;

/// Records the entry's binding on the audit line and answers whether the call was admitted by
/// path only (the report's `identity_unavailable` note). The warning slot stays with the caller.
pub(super) fn bind_audit(record: &mut Record, binding: Option<&(bool, Option<Vec<u8>>)>) -> bool {
    let identity_unavailable = binding.is_some_and(|(by_identity, _)| !by_identity);
    if let Some((by_identity, observed)) = binding {
        record.event.bind_app(*by_identity, observed.as_deref());
    }
    identity_unavailable
}
