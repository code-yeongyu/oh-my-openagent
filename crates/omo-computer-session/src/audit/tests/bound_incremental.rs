//! R7-7 bound test (3): the incremental read. After the worst-case first read, one refusal-free
//! line and one consent_save allow from a non-authority key are appended to audit.jsonl; the next admission read
//! reads exactly the appended bytes and still reads tampered (nothing clears until row 37).

use std::fs::OpenOptions;
use std::io::Write;

use serde_json::json;

use super::bound_fixture::{Big, HAND, LIMITS};
use crate::audit::{HandScan, Tamper};

#[test]
fn bound_3_a_later_read_covers_only_the_appended_bytes() {
    let mut big = Big::new();
    let refusal = big.refusal(0);
    let (retired, current) = (big.retired(), big.current());
    big.fill(&retired, true, Some(refusal));
    std::fs::write(&current, b"").expect("an empty current file");
    let mut process = HandScan::default();
    let first = process.read(big.dir.path(), HAND, LIMITS);
    assert_eq!(first.tampered, Some(Tamper::Marked));
    let appended = format!(
        "{}{}",
        big.click(1, 400),
        big.stamped(2, json!({ "action": "consent.save", "target": "consent", "status": "success",
            "grant": { "kind": "consent_save", "verdict": "allow" } }))
    );
    let mut file = OpenOptions::new().append(true).open(&current).expect("open");
    file.write_all(appended.as_bytes()).expect("append");
    drop(file);
    let next = process.read(big.dir.path(), HAND, LIMITS);
    assert_eq!(next.tampered, Some(Tamper::Marked), "a non-authority consent_save clears nothing");
    assert_eq!(next.stats.bytes_read, appended.len() as u64, "only the appended bytes are read");
}
