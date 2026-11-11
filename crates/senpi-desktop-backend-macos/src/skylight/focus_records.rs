//! The key-priming records: a focus record and the make-key pair for one
//! window, posted only to the process that owns it. There is deliberately no
//! defocus record: posted to a background application on macOS 26 it was
//! delivered as a destructive input event and wiped the typed document
//! (`focus::restore_key_focus`). These records cannot type, so they never
//! call `mark_sent`.

use std::thread;
use std::time::Duration;

use super::psn::{focus_record, process_psn, FocusMarker, EVENT_RECORD_LENGTH};
use super::spi;

/// The make-key record's event kinds, posted in this order.
const MAKE_KEY_KINDS: [u8; 2] = [0x01, 0x02];
const MAKE_KEY_FLAG_OFFSET: usize = 0x3a;
const MAKE_KEY_FLAG: u8 = 0x10;
const MAKE_KEY_MASK: std::ops::Range<usize> = 0x20..0x30;
const KIND_OFFSET: usize = 0x08;
const WINDOW_ID_OFFSET: usize = 0x3c;

/// The pause after the focus record: short, or the full form's settle.
const SHORT_PAUSE: Duration = Duration::from_millis(10);
const FULL_SETTLE: Duration = Duration::from_millis(120);

/// One make-key record for `wid`. Pure: only the byte assembly.
pub(super) fn make_key_record(wid: u32, kind: u8) -> [u8; EVENT_RECORD_LENGTH] {
    let mut record = [0u8; EVENT_RECORD_LENGTH];
    record[0x04] = 0xf8;
    record[KIND_OFFSET] = kind;
    record[WINDOW_ID_OFFSET..WINDOW_ID_OFFSET + 4].copy_from_slice(&wid.to_le_bytes());
    record[MAKE_KEY_FLAG_OFFSET] = MAKE_KEY_FLAG;
    record[MAKE_KEY_MASK].fill(0xff);
    record
}

/// The records of one priming move, in posting order: the focus record,
/// then the make-key pair. Never a defocus record.
pub(super) fn key_records(wid: u32) -> [[u8; EVENT_RECORD_LENGTH]; 3] {
    [
        focus_record(wid, FocusMarker::Focus),
        make_key_record(wid, MAKE_KEY_KINDS[0]),
        make_key_record(wid, MAKE_KEY_KINDS[1]),
    ]
}

/// Posts the key records for `(pid, wid)` to that process only, pausing
/// after the focus record (the full form settles longer). `false` when the
/// SPI is missing, the process has no PSN, or a post was refused.
pub(crate) fn post_key_records(pid: libc::pid_t, wid: u32, full: bool) -> bool {
    let Ok(spi) = spi::required() else {
        return false;
    };
    let Some(psn) = process_psn(spi.psn, pid, wid) else {
        return false;
    };
    let mut all_posted = true;
    for (index, record) in key_records(wid).iter().enumerate() {
        // SAFETY: Both the PSN and the complete 248-byte record live through
        // the synchronous SPI call.
        all_posted &= unsafe { (spi.post_record)(&psn, record.as_ptr()) } == 0;
        if index == 0 {
            thread::sleep(if full { FULL_SETTLE } else { SHORT_PAUSE });
        }
    }
    all_posted
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Where a focus record carries its marker: `0x01` focus, `0x02` defocus.
    const FOCUS_MARKER_OFFSET: usize = 0x8a;

    #[test]
    fn priming_posts_focus_then_make_key_and_never_a_defocus_record() {
        let records = key_records(0x0a0b_0c0d);
        assert_eq!(records[0][FOCUS_MARKER_OFFSET], 0x01, "focus marker");
        assert_eq!(records[0][KIND_OFFSET], 0x0d);
        for record in &records {
            assert_eq!(record[0x04], 0xf8);
            assert_eq!(&record[0x3c..0x40], &0x0a0b_0c0d_u32.to_le_bytes());
            assert_ne!(record[FOCUS_MARKER_OFFSET], 0x02, "a defocus record");
        }
        for (record, kind) in records[1..].iter().zip(MAKE_KEY_KINDS) {
            assert_eq!(record[KIND_OFFSET], kind);
            assert_eq!(record[MAKE_KEY_FLAG_OFFSET], MAKE_KEY_FLAG);
            assert!(record[MAKE_KEY_MASK].iter().all(|&byte| byte == 0xff));
        }
    }
}
