//! The authority host's rotation under the hand's lock, carrying an unresolved mark (A-IS-62 R7-3).

use std::fs;
use std::io;

use super::{AuditWriter, ROTATED_FILE};
use crate::audit::scan::{HandScan, Tamper, LINE_STAMP_BYTES};
use crate::audit::segment::{chain_link, stamp};

impl AuditWriter {
    /// R7-3, under the hand's lock from the scan through the new file's first records: reads
    /// audit.1.jsonl and the file it retires; when either holds an unresolved mark (or reads
    /// tampered), appends a carried mark as the retiring file's last line, renames, and opens the
    /// new file with an anchor that carries the mark. A file it cannot read means no rotation.
    pub(super) fn rotate(&mut self) -> io::Result<()> {
        let dir = self.hand_dir()?.to_owned();
        let hand = self.segment.hand_id().to_owned();
        let carry = match HandScan::default().read_held(&dir, &hand, self.limits).tampered {
            None => false,
            Some(Tamper::Unreadable) => {
                return Err(io::Error::other("the hand's audit cannot be read: no rotation"))
            }
            Some(_) => true,
        };
        if carry {
            let mut segment = self.segment.clone();
            let mut line = stamp(&mut segment, &crate::audit::mark::carried_mark())?.to_string();
            line.push('\n');
            self.write_held(line.as_bytes())?;
            self.segment = segment;
        }
        let max_line = self.limits.max_event + LINE_STAMP_BYTES;
        let last = chain_link(&self.path, max_line);
        fs::rename(&self.path, self.path.with_file_name(ROTATED_FILE))?;
        self.open_segment(last, carry)
    }
}
