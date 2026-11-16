//! R7-7 bound test (1): the worst-case first read at 130 MiB. audit.1.jsonl and audit.jsonl each
//! hold exactly hard_cap + max_event of real stamped lines from four interleaved keys; a chord
//! refusal is the first stamped line of audit.1.jsonl; nothing lets the read stop early. It reads
//! tampered in ONE pass: bytes read equal the two sizes, the largest line buffer stays at most
//! max_event + 4 KiB, each file is opened once. Elapsed time is printed as evidence (ceiling 5 s
//! on a hosted Linux runner); the hard assertions are the byte, buffer and open counts.

use super::bound_fixture::{Big, FULL, LIMITS};
use crate::audit::{Tamper, LINE_STAMP_BYTES};

#[test]
fn bound_1_the_worst_case_first_read_is_one_pass_of_both_files() {
    let mut big = Big::new();
    let refusal = big.refusal(0);
    let (retired, current) = (big.retired(), big.current());
    big.fill(&retired, true, Some(refusal));
    big.fill(&current, false, None);
    let started = std::time::Instant::now();
    let read = big.read();
    println!("evidence bound_1: {:?} for {} bytes", started.elapsed(), 2 * FULL);
    assert_eq!(read.tampered, Some(Tamper::Marked));
    assert_eq!(read.stats.bytes_read, 2 * FULL, "one pass, nothing read twice");
    assert!(read.stats.largest_line <= LIMITS.max_event + LINE_STAMP_BYTES, "{:?}", read.stats);
    assert_eq!(read.stats.opened, 2, "each file opened once");
}
