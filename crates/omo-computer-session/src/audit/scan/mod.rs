//! The read of a hand's audit (A-IS-62 R7-2, R7-4, R7-7): under the hand's lock, `audit.1.jsonl`
//! while one exists, then `audit.jsonl`, each line checked by writer key (`chain`), bounded in
//! bytes and memory (`reader`). A process reads the whole audit once; each later read covers only
//! what was appended since its kept offsets (after a rotation, the rest of the retired file, then
//! the new file). Until row 37 nothing clears a mark: a chord refusal or a carried mark reads
//! tampered for good, and a tampered read stays tampered in that process.

mod chain;
mod reader;

use std::path::{Path, PathBuf};

pub use reader::LINE_STAMP_BYTES;
pub(crate) use reader::identity;
use reader::{read_lines, stat, Seen};

use super::handlock::HandLock;
use super::writer::{AuditLimits, AUDIT_FILE, ROTATED_FILE};

/// Why a hand reads tampered (R7-4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tamper {
    /// A file or segment that exists and cannot be read (or a hand lock that cannot be taken).
    Unreadable,
    /// A symlink or a non-regular file at either path.
    NotRegular,
    /// A line that does not parse, the last line included.
    Unparseable,
    /// A line longer than `max_event` plus its stamp.
    LongLine,
    /// A writer key with no `audit.meta` before its first line.
    NoMeta,
    /// A repeated or skipped `seq` within a key.
    Seq,
    /// A broken `prev` within a key, or a line whose content no longer matches its `lineHash`.
    Prev,
    /// A line of another hand.
    ForeignHand,
    /// A `rotation_anchor` whose `prev` is not the line before it (the retired file's last).
    AnchorLink,
    /// A file larger than `hard_cap + max_event` (R7-7): read tampered, nothing read.
    OverCap,
    /// A file this process read is gone or shorter with no completed rotation to explain it.
    Vanished,
    /// A chord refusal or a carried mark with no clearing line (none clears until row 37).
    Marked,
}

/// What one read cost (R7-7's bound is asserted on these).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ScanStats {
    pub bytes_read: u64,
    pub largest_line: u64,
    pub opened: u32,
}

/// The result of one read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanRead {
    pub tampered: Option<Tamper>,
    pub stats: ScanStats,
}

#[derive(Debug, Clone, Copy, Default)]
struct Kept {
    retired: Option<(Seen, u64)>,
    current: Option<(Seen, u64)>,
}

/// One process's reads of one hand.
#[derive(Debug, Default)]
pub struct HandScan {
    kept: Option<Kept>,
    chain: chain::Chain,
    latched: Option<Tamper>,
}

impl HandScan {
    /// Reads the hand `hand` under `audit_dir`, taking the hand's lock. Absent files read not
    /// tampered and create nothing.
    pub fn read(&mut self, audit_dir: &Path, hand: &str, limits: AuditLimits) -> ScanRead {
        let dir = audit_dir.join("computer").join(hand);
        let absent = |name: &str| std::fs::symlink_metadata(dir.join(name)).is_err();
        if self.latched.is_none() && self.kept.is_none() && absent(AUDIT_FILE) && absent(ROTATED_FILE) {
            return ScanRead { tampered: None, stats: ScanStats::default() };
        }
        match HandLock::take(&dir) {
            Ok(_held) => self.read_held(&dir, hand, limits),
            Err(_) => self.latch(Tamper::Unreadable, ScanStats::default()),
        }
    }

    /// The same read for a caller that already holds the hand's lock (the rotating writer).
    pub(crate) fn read_held(&mut self, dir: &Path, hand: &str, limits: AuditLimits) -> ScanRead {
        let mut stats = ScanStats::default();
        if let Some(tamper) = self.latched {
            return ScanRead { tampered: Some(tamper), stats };
        }
        // A broken file latches (its offsets mean nothing any more); a mark does not, so later
        // reads still cover only the appended bytes (R7-7), and stay tampered (the chain keeps it).
        match self.advance(dir, hand, limits, &mut stats) {
            Err(tamper) => self.latch(tamper, stats),
            Ok(()) if self.chain.marked => ScanRead { tampered: Some(Tamper::Marked), stats },
            Ok(()) => ScanRead { tampered: None, stats },
        }
    }

    fn latch(&mut self, tamper: Tamper, stats: ScanStats) -> ScanRead {
        self.latched = Some(tamper);
        ScanRead { tampered: Some(tamper), stats }
    }

    /// Plans which bytes are new since the kept offsets, then reads them in order.
    fn advance(&mut self, dir: &Path, hand: &str, limits: AuditLimits, stats: &mut ScanStats) -> Result<(), Tamper> {
        let cap = limits.hard_cap + limits.max_event;
        let (retired_path, current_path) = (dir.join(ROTATED_FILE), dir.join(AUDIT_FILE));
        let retired = stat(&retired_path, cap)?;
        let current = stat(&current_path, cap)?;
        let kept = self.kept.unwrap_or_default();
        let mut plan: Vec<(PathBuf, Seen, u64, bool)> = Vec::new();
        let rotated = matches!((kept.current, retired), (Some((was, _)), Some(now)) if was.id == now.id);
        if rotated {
            let (_, from) = kept.current.ok_or(Tamper::Vanished)?;
            plan.push((retired_path, retired.ok_or(Tamper::Vanished)?, from, true));
            if let Some(now) = current {
                plan.push((current_path, now, 0, false));
            }
        } else {
            plan.extend(continue_from(kept.retired, retired, &retired_path, true)?);
            plan.extend(continue_from(kept.current, current, &current_path, false)?);
        }
        let max_line = limits.max_event + LINE_STAMP_BYTES;
        let mut next = Kept::default();
        for (path, seen, from, is_retired) in plan {
            if seen.len < from {
                return Err(Tamper::Vanished);
            }
            let reached = read_lines(&path, from, max_line, stats, |line| self.chain.line(line, hand))?;
            let entry = Some((Seen { len: reached, ..seen }, reached));
            if is_retired { next.retired = entry } else { next.current = entry }
        }
        if !rotated {
            next.retired = next.retired.or(kept.retired);
            next.current = next.current.or(kept.current);
        }
        self.kept = Some(next);
        Ok(())
    }
}

/// The part of one file to read next: from the kept offset when it is the same file, from the
/// start when this process never saw one there; a kept file that is gone or replaced vanished.
fn continue_from(
    kept: Option<(Seen, u64)>,
    now: Option<Seen>,
    path: &Path,
    is_retired: bool,
) -> Result<Option<(PathBuf, Seen, u64, bool)>, Tamper> {
    match (kept, now) {
        (Some((was, from)), Some(now)) if was.id == now.id => Ok((now.len != from).then(|| (path.to_owned(), now, from, is_retired))),
        (Some(_), _) => Err(Tamper::Vanished),
        (None, Some(now)) => Ok(Some((path.to_owned(), now, 0, is_retired))),
        (None, None) => Ok(None),
    }
}
