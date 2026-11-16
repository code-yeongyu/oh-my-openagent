//! ONE audit file per hand, `<auditDir>/computer/<handId>/audit.jsonl` (0600), written by
//! every writer of the uid as per-writer segments keyed `(writerPid, writerProcStartMs, seq)`
//! under the hand's lock (`audit.lock`, A-IS-62 R7-3), which every writer also holds for its size
//! checks and the rotation, on every OS; the data file itself is never locked, so a reader never
//! fails on a byte-range lock (A-IS-65 L7). Each segment opens with `audit.meta`; the AUTHORITY host's segment
//! follows it with a `rotation_anchor` grant. Only the authority host rotates (at
//! `rotate_at`, to `audit.1.jsonl`); any other writer keeps appending up to `hard_cap` and
//! then refuses exec `audit_unavailable`.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use omo_computer_core::backend::Refusal;
use serde_json::json;

use super::line::{now_ms, AuditEvent};
use super::handlock::HandLock;
use super::mark::is_chord_refusal_event;
use super::scan::{HandScan, Tamper};
use super::segment::{anchor_event, chain_link, stamp, truncated, Segment};
use super::sink::{AuditSink, AUDIT_UNAVAILABLE};

pub const AUDIT_FILE: &str = "audit.jsonl";
pub const ROTATED_FILE: &str = "audit.1.jsonl";
/// The hand's lock, beside the data file (A-IS-62.md:243, A-IS-65 L7).
pub const AUDIT_LOCK_FILE: &str = super::handlock::LOCK_FILE;
const MIB: u64 = 1024 * 1024;

/// `<auditDir>/computer/<handId>/audit.jsonl`.
#[must_use]
pub fn audit_path(audit_dir: &Path, hand_id: &str) -> PathBuf {
    audit_dir.join("computer").join(hand_id).join(AUDIT_FILE)
}

/// The segment key of one writer process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriterId {
    pub pid: u32,
    pub proc_start_ms: u64,
}

impl WriterId {
    /// This process, with the start time it first read.
    #[must_use]
    pub fn current() -> Self {
        static START: OnceLock<u64> = OnceLock::new();
        Self {
            pid: std::process::id(),
            proc_start_ms: *START.get_or_init(now_ms),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuditLimits {
    pub rotate_at: u64,
    pub hard_cap: u64,
    pub max_event: u64,
}

impl Default for AuditLimits {
    fn default() -> Self {
        Self {
            rotate_at: 50 * MIB,
            hard_cap: 64 * MIB,
            max_event: MIB,
        }
    }
}

/// What the authority host's `rotation_anchor` line carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Anchor {
    pub fingerprint: String,
    pub suspended: bool,
    pub stop_epoch: u64,
}

/// The writer of one process into the hand's one file.
#[derive(Debug)]
pub struct AuditWriter {
    path: PathBuf,
    segment: Segment,
    limits: AuditLimits,
    authority: Option<Anchor>,
    degraded: bool,
    /// This segment already used its one chord-refusal line past the hard cap (R7-2).
    cap_refusal_written: bool,
    audit_dir: PathBuf,
    /// This process's reads of the hand (R7-2): whole once, then only what was appended.
    scan: HandScan,
}

impl AuditWriter {
    /// Opens the hand's file and starts this writer's segment with `audit.meta`.
    ///
    /// # Errors
    /// The file cannot be created, opened or appended.
    pub fn open(
        audit_dir: &Path,
        hand_id: &str,
        generation: u64,
        writer: WriterId,
        limits: AuditLimits,
    ) -> io::Result<Self> {
        Self::start(audit_dir, hand_id, generation, writer, limits, None)
    }

    /// The authority host's writer: its segment's first line after `audit.meta` is the
    /// `rotation_anchor` whose `prev` is the file's last `lineHash`.
    ///
    /// # Errors
    /// The file cannot be created, opened or appended.
    pub fn open_authority(
        audit_dir: &Path,
        hand_id: &str,
        generation: u64,
        writer: WriterId,
        limits: AuditLimits,
        anchor: Anchor,
    ) -> io::Result<Self> {
        Self::start(audit_dir, hand_id, generation, writer, limits, Some(anchor))
    }

    fn start(
        audit_dir: &Path,
        hand_id: &str,
        generation: u64,
        writer: WriterId,
        limits: AuditLimits,
        authority: Option<Anchor>,
    ) -> io::Result<Self> {
        let path = audit_path(audit_dir, hand_id);
        let dir = path
            .parent()
            .ok_or_else(|| io::Error::other("no audit dir"))?;
        crate::marker::private_dir(dir)?;
        let _held = HandLock::take(dir)?;
        let mut this = Self {
            path,
            segment: Segment::new(hand_id, generation, writer),
            limits,
            authority,
            degraded: false,
            cap_refusal_written: false,
            audit_dir: audit_dir.to_owned(),
            scan: HandScan::default(),
        };
        let last = chain_link(&this.path);
        this.open_segment(last)?;
        Ok(this)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    #[must_use]
    pub const fn degraded(&self) -> bool {
        self.degraded
    }

    /// `last`: the last `lineHash` of the segment this one follows.
    fn open_segment(&mut self, last: Option<String>) -> io::Result<()> {
        self.segment.seq = 0;
        self.segment.prev = "meta".to_owned();
        self.cap_refusal_written = false;
        let mut lines = vec![self.segment.meta()];
        if let Some(anchor) = self.authority.clone() {
            let mut line = stamp(&mut self.segment, &anchor_event(&anchor))?;
            let prev = last.unwrap_or_else(|| "meta".to_owned());
            line["prev"] = json!(prev);
            lines.push(line);
        }
        let mut text = String::new();
        for line in lines {
            text.push_str(&line.to_string());
            text.push('\n');
        }
        self.write_held(text.as_bytes())
    }

    /// Appends `bytes` to the hand's file; the caller holds the hand's lock.
    fn write_held(&self, bytes: &[u8]) -> io::Result<()> {
        let mut options = OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = options.open(&self.path)?;
        file.write_all(bytes)?;
        file.sync_data()
    }

    fn hand_dir(&self) -> io::Result<&Path> {
        self.path
            .parent()
            .ok_or_else(|| io::Error::other("no audit dir"))
    }

    fn size(&self) -> u64 {
        fs::metadata(&self.path).map_or(0, |meta| meta.len())
    }

    fn rotate(&mut self) -> io::Result<()> {
        let rotated = self.path.with_file_name(ROTATED_FILE);
        let last = chain_link(&self.path);
        fs::rename(&self.path, rotated)?;
        self.open_segment(last)
    }
}

impl AuditSink for AuditWriter {
    fn admit(&self) -> Result<(), Refusal> {
        // The size is read under the hand's lock (R7-7); a lock that cannot be taken refuses.
        let held = self.hand_dir().and_then(HandLock::take);
        if self.degraded || held.is_err() || self.size() >= self.limits.hard_cap {
            Err(AUDIT_UNAVAILABLE)
        } else {
            Ok(())
        }
    }

    fn append(&mut self, event: AuditEvent) -> io::Result<String> {
        let written = self.append_line(event);
        self.degraded = written.is_err();
        written
    }

    fn path(&self) -> Option<&Path> {
        Some(&self.path)
    }

    fn read_mark(&mut self) -> Option<Tamper> {
        let hand = self.segment.hand_id().to_owned();
        self.scan.read(&self.audit_dir, &hand, self.limits).tampered
    }
}

impl AuditWriter {
    fn append_line(&mut self, event: AuditEvent) -> io::Result<String> {
        // R7-3 / R7-7: the size checks, the rotation and the append run under the hand's lock,
        // so two writers can never both find room and overshoot together. A writer that cannot
        // rotate does not, and is refused at hard_cap like any other, the authority included.
        let _held = HandLock::take(self.hand_dir()?)?;
        if self.authority.is_some() && self.size() >= self.limits.rotate_at {
            if let Err(error) = self.rotate() {
                eprintln!("omo-computer-engine: warn audit not rotated, refused at its hard cap: {error}");
            }
        }
        // R7-2: the hard cap never refuses a chord refusal's line: one per segment past it.
        let refusal = is_chord_refusal_event(&event);
        let past_cap = self.size() >= self.limits.hard_cap;
        if past_cap && !(refusal && !self.cap_refusal_written) {
            return Err(io::Error::other("the audit file is at its hard cap"));
        }
        let mut segment = self.segment.clone();
        let mut line = stamp(&mut segment, &event)?.to_string();
        // A refusal line is never written as a truncated event (row 21 cuts its chords).
        if !refusal && line.len() as u64 > self.limits.max_event {
            segment = self.segment.clone();
            line = stamp(&mut segment, &truncated(&event))?.to_string();
        }
        line.push('\n');
        self.write_held(line.as_bytes())?;
        self.segment = segment;
        self.cap_refusal_written |= past_cap;
        Ok(self.segment.prev.clone())
    }
}
