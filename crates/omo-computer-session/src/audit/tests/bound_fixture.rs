//! The 130 MiB worst case of A-IS-62 R7-7 (the security read's question (7)): audit files of
//! real stamped lines of 300 to 600 bytes from four interleaved writer keys, written straight to
//! disk (a writer syncs every append; these files are built in one pass), each chain valid.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::audit::{line_hash, AuditLimits, HandScan, ScanRead};

pub(super) const HAND: &str = "hand-1";
const KEYS: [u64; 4] = [101, 102, 103, 104];

/// The default limits the bound is stated at.
pub(super) const LIMITS: AuditLimits = AuditLimits {
    rotate_at: 50 * 1024 * 1024,
    hard_cap: 64 * 1024 * 1024,
    max_event: 1024 * 1024,
};

/// Each file's size: exactly `hard_cap + max_event`.
pub(super) const FULL: u64 = LIMITS.hard_cap + LIMITS.max_event;

pub(super) struct Big {
    pub(super) dir: tempfile::TempDir,
    seqs: [u64; 4],
    prevs: [String; 4],
}

impl Big {
    /// A hand under the lane's temp dir, removed when dropped.
    pub(super) fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("tempdir"),
            seqs: [0; 4],
            prevs: std::array::from_fn(|_| "meta".to_owned()),
        }
    }

    pub(super) fn hand_dir(&self) -> PathBuf {
        let dir = self.dir.path().join("computer").join(HAND);
        fs::create_dir_all(&dir).expect("hand dir");
        dir
    }

    pub(super) fn retired(&self) -> PathBuf {
        self.hand_dir().join("audit.1.jsonl")
    }

    pub(super) fn current(&self) -> PathBuf {
        self.hand_dir().join("audit.jsonl")
    }

    fn meta(key: u64) -> Value {
        json!({ "kind": "audit.meta", "schema": 2, "handId": HAND, "generation": 1, "os": "linux",
                "writerPid": key, "writerProcStartMs": 7 })
    }

    /// The next stamped line of writer `slot` with `body`'s members.
    pub(super) fn stamped(&mut self, slot: usize, body: Value) -> String {
        let mut line = json!({ "v": 2, "ts": "2026-11-16T00:00:00.000Z", "handId": HAND, "generation": 1,
                               "writerPid": KEYS[slot], "writerProcStartMs": 7, "seq": self.seqs[slot] + 1 });
        if let (Some(line), Value::Object(body)) = (line.as_object_mut(), body) {
            line.extend(body);
        }
        let hash = line_hash(&line);
        line["prev"] = json!(self.prevs[slot]);
        line["lineHash"] = json!(hash);
        self.seqs[slot] += 1;
        self.prevs[slot] = hash;
        let mut text = line.to_string();
        text.push('\n');
        text
    }

    /// A refusal-free click line padded to about `size` bytes.
    pub(super) fn click(&mut self, slot: usize, size: usize) -> String {
        let pad = size.saturating_sub(260);
        self.stamped(slot, json!({ "action": "click", "target": "window:101", "status": "success",
                                  "evidence": ["x".repeat(pad)] }))
    }

    pub(super) fn refusal(&mut self, slot: usize) -> String {
        self.stamped(slot, json!({ "action": "stopPath.start", "target": "stop_hotkey", "status": "refused",
            "gate": { "outcome": "refused", "stage": "Consent", "code": "ControlRequired", "reason": "tampered" },
            "evidence": ["configured=ctrl+alt+shift+escape", "carried=ctrl+q"] }))
    }

    /// Writes `path` to exactly `FULL` bytes: the four metas (when `metas`), `first` (if any),
    /// then lines of 300 to 600 bytes from the four keys in turn; the last line pads to fit.
    pub(super) fn fill(&mut self, path: &Path, metas: bool, first: Option<String>) {
        let mut out = BufWriter::new(File::create(path).expect("create"));
        let mut written: u64 = 0;
        let put = |out: &mut BufWriter<File>, written: &mut u64, text: &str| {
            out.write_all(text.as_bytes()).expect("write");
            *written += text.len() as u64;
        };
        if metas {
            for key in KEYS {
                put(&mut out, &mut written, &format!("{}\n", Self::meta(key)));
            }
        }
        if let Some(first) = first {
            put(&mut out, &mut written, &first);
        }
        let mut turn = 0_usize;
        loop {
            let left = FULL - written;
            let size = 300 + (turn * 37) % 300;
            if left < 2 * 600 {
                // The last line's padding is measured on a copy of the chain, then written once.
                let probe = Self { dir: tempfile::tempdir().expect("tempdir"), seqs: self.seqs, prevs: self.prevs.clone() }
                    .click(turn % 4, 0);
                let pad = usize::try_from(left).expect("fits") - probe.len() + 260;
                let text = self.click(turn % 4, pad);
                assert_eq!(text.len() as u64, left, "the last line fills the file exactly");
                put(&mut out, &mut written, &text);
                break;
            }
            let text = self.click(turn % 4, size);
            put(&mut out, &mut written, &text);
            turn += 1;
        }
        out.flush().expect("flush");
    }

    /// A first read by a fresh process.
    pub(super) fn read(&self) -> ScanRead {
        HandScan::default().read(self.dir.path(), HAND, LIMITS)
    }
}
