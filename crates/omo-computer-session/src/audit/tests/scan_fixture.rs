//! A hand's audit written by real writers in a temp dir, and the byte edits the R7-4 cases make.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::audit::{
    Anchor, AuditEvent, AuditLimits, AuditSink, AuditWriter, HandScan, Tamper, WriterId,
    AUDIT_FILE, ROTATED_FILE,
};

pub(super) const HAND: &str = "hand-1";

pub(super) struct Hand {
    pub(super) dir: tempfile::TempDir,
}

impl Hand {
    pub(super) fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("tempdir"),
        }
    }

    pub(super) fn hand_dir(&self) -> PathBuf {
        self.dir.path().join("computer").join(HAND)
    }

    pub(super) fn current(&self) -> PathBuf {
        self.hand_dir().join(AUDIT_FILE)
    }

    pub(super) fn retired(&self) -> PathBuf {
        self.hand_dir().join(ROTATED_FILE)
    }

    pub(super) fn writer(&self, pid: u32, limits: AuditLimits) -> AuditWriter {
        AuditWriter::open(self.dir.path(), HAND, 1, id(pid), limits).expect("writer")
    }

    pub(super) fn authority(&self, pid: u32, limits: AuditLimits) -> AuditWriter {
        let anchor = Anchor {
            fingerprint: "fp-1".to_owned(),
            suspended: false,
            stop_epoch: 0,
        };
        AuditWriter::open_authority(self.dir.path(), HAND, 1, id(pid), limits, anchor)
            .expect("authority")
    }

    /// Two writer keys interleaved, three lines each: a healthy hand.
    pub(super) fn healthy(&self) {
        let mut first = self.writer(11, AuditLimits::default());
        let mut second = self.writer(12, AuditLimits::default());
        for _ in 0..3 {
            first.append(click()).expect("append");
            second.append(click()).expect("append");
        }
    }

    /// What a process reading this hand for the first time reads.
    pub(super) fn read(&self) -> Option<Tamper> {
        HandScan::default()
            .read(self.dir.path(), HAND, AuditLimits::default())
            .tampered
    }
}

pub(super) const fn id(pid: u32) -> WriterId {
    WriterId {
        pid,
        proc_start_ms: 7,
    }
}

pub(super) fn click() -> AuditEvent {
    AuditEvent {
        action: "click".to_owned(),
        target: "window:101".to_owned(),
        ..AuditEvent::default()
    }
}

pub(super) fn lines(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .expect("audit file")
        .lines()
        .map(str::to_owned)
        .collect()
}

pub(super) fn write_lines(path: &Path, lines: &[String]) {
    let mut text = lines.join("\n");
    text.push('\n');
    fs::write(path, text).expect("rewrite");
}

/// Rewrites the `index`th stamped line of `path` through `edit` (its `lineHash` is kept as it was).
pub(super) fn edit_stamped(path: &Path, index: usize, edit: impl FnOnce(&mut Value)) {
    let mut all = lines(path);
    let at = all
        .iter()
        .enumerate()
        .filter(|(_, line)| !line.contains("\"audit.meta\""))
        .nth(index)
        .map(|(at, _)| at)
        .expect("a stamped line");
    let mut line: Value = serde_json::from_str(&all[at]).expect("JSON");
    edit(&mut line);
    all[at] = line.to_string();
    write_lines(path, &all);
}
