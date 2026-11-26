//! R7-7 bound test (2): the start at an anchor. Until row 37 no host confirms an anchor, so the
//! read NEVER starts at one in this PR: with the authority's anchor carrying the mark at the head
//! of audit.jsonl, the read still covers both files in full and reads tampered. The anchor-start
//! form is owed to row 37 (DEFERRED-LEGS).

use serde_json::json;

use super::bound_fixture::{Big, FULL};
use crate::audit::Tamper;

#[test]
fn bound_2_an_unconfirmed_anchor_is_never_a_start_point_and_the_read_is_full() {
    let mut big = Big::new();
    let refusal = big.refusal(0);
    let (retired, current) = (big.retired(), big.current());
    big.fill(&retired, true, Some(refusal));
    let anchor = big.stamped(1, json!({ "action": "consent.anchor", "target": "control", "status": "success",
        "evidence": ["carried_mark"], "grant": { "kind": "consent_save", "verdict": "rotation_anchor" } }));
    big.fill(&current, false, Some(anchor));
    let read = big.read();
    assert_eq!(read.tampered, Some(Tamper::Marked));
    assert_eq!(read.stats.bytes_read, 2 * FULL, "no unconfirmed anchor shortens the read");
    assert_eq!(read.stats.opened, 2);
}
