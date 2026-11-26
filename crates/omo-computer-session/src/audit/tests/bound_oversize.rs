//! R7-7 bound test (4): oversize files read tampered unread. A sparse audit.jsonl of 3 x hard_cap
//! reads tampered with nothing read past the stat; a file holding one line of 2 x max_event with
//! no newline reads tampered while the largest buffer stays at most max_event + 4 KiB.

use std::fs::{File, OpenOptions};
use std::io::Write;

use super::bound_fixture::{Big, LIMITS};
use crate::audit::{Tamper, LINE_STAMP_BYTES};

#[test]
fn bound_4_a_sparse_file_over_the_cap_reads_tampered_unread() {
    let big = Big::new();
    let file = File::create(big.current()).expect("create");
    file.set_len(3 * LIMITS.hard_cap).expect("sparse");
    let read = big.read();
    assert_eq!(read.tampered, Some(Tamper::OverCap));
    assert_eq!(read.stats.bytes_read, 0, "nothing read past the stat");
}

#[test]
fn bound_4_one_line_of_twice_max_event_reads_tampered_with_a_bounded_buffer() {
    let big = Big::new();
    let mut file = OpenOptions::new().create(true).write(true).truncate(true).open(big.current()).expect("create");
    let line = vec![b'a'; usize::try_from(2 * LIMITS.max_event).expect("fits")];
    file.write_all(&line).expect("one long line, no newline");
    drop(file);
    let read = big.read();
    assert_eq!(read.tampered, Some(Tamper::LongLine));
    assert!(read.stats.largest_line <= LIMITS.max_event + LINE_STAMP_BYTES, "{:?}", read.stats);
}
