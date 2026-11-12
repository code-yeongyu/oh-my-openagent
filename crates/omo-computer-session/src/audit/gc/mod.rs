//! Bounded artifact retention on the hand: age (`stale_ms`, 12 h), bytes (512 MiB) and files
//! (2,000), scoped to the `senpi-computer-` prefix with a `.png` / `.jpg` suffix and to the
//! `senpi-computer-sessions/<id>/` trace dirs; every other file is foreign and never touched.
//! Sweeps run at `session.open`, at idle exit, on the 1,800,000 ms timer and when a write
//! crosses a cap (oldest first, down to 80 % of each cap). An IO error is one `warn` line:
//! the sweep goes on and the capture that triggered it still succeeds.

mod entries;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use entries::{dir_entry, file_entry, list, remove, Entry};

/// The artifact file prefix (unchanged on purpose: other programs read it).
pub const ARTIFACT_PREFIX: &str = "senpi-computer-";
/// The trace session dirs, swept as prefixed artifacts.
pub const SESSIONS_DIR: &str = "senpi-computer-sessions";
/// The timer sweep's period.
pub const SWEEP_INTERVAL_MS: u64 = 1_800_000;
const SUFFIXES: [&str; 2] = [".png", ".jpg"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GcLimits {
    pub stale_ms: u64,
    pub max_bytes: u64,
    pub max_files: u64,
}

impl Default for GcLimits {
    fn default() -> Self {
        Self {
            stale_ms: 12 * 3_600_000,
            max_bytes: 512 * 1024 * 1024,
            max_files: 2_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SweepTrigger {
    Open,
    IdleExit,
    Timer,
    CapCrossing,
}

/// One sweep, as the trace records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SweepReport {
    pub trigger: SweepTrigger,
    pub at_ms: u64,
    pub removed: u64,
    pub bytes: u64,
    pub files: u64,
    pub warnings: Vec<String>,
}

/// The per-hand artifact dir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactStore {
    dir: PathBuf,
    limits: GcLimits,
    next_timer_ms: Option<u64>,
    sweeps: Vec<SweepReport>,
}

/// `senpi-computer-<digest>.<ext>`.
#[must_use]
pub fn artifact_name(digest: &str, ext: &str) -> String {
    format!("{ARTIFACT_PREFIX}{digest}.{ext}")
}

impl ArtifactStore {
    #[must_use]
    pub const fn new(dir: PathBuf, limits: GcLimits) -> Self {
        Self {
            dir,
            limits,
            next_timer_ms: None,
            sweeps: Vec::new(),
        }
    }

    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Every sweep so far, oldest first.
    #[must_use]
    pub fn sweeps(&self) -> &[SweepReport] {
        &self.sweeps
    }

    /// `(bytes, files)` of the prefixed artifacts now on disk.
    #[must_use]
    pub fn usage(&self) -> (u64, u64) {
        let entries = self.entries(&mut Vec::new());
        (
            entries.iter().map(|entry| entry.bytes).sum(),
            entries.len() as u64,
        )
    }

    /// Writes one artifact; a write that crosses a cap sweeps.
    ///
    /// # Errors
    /// The artifact itself could not be written (a sweep error only warns).
    pub fn record(
        &mut self,
        digest: &str,
        ext: &str,
        bytes: &[u8],
        now_ms: u64,
    ) -> io::Result<PathBuf> {
        fs::create_dir_all(&self.dir)?;
        let path = self.dir.join(artifact_name(digest, ext));
        fs::write(&path, bytes)?;
        let (total, files) = self.usage();
        if total > self.limits.max_bytes || files > self.limits.max_files {
            self.sweep(now_ms, SweepTrigger::CapCrossing);
        }
        Ok(path)
    }

    /// `artifact.release(digest)`: deletes the artifact; a second release is a no-op.
    /// A removal that fails for any reason but "not there" is logged and reads as not
    /// released, never as a quiet second release.
    pub fn release(&mut self, digest: &str) -> bool {
        let mut released = false;
        for suffix in SUFFIXES {
            let path = self.dir.join(format!("{ARTIFACT_PREFIX}{digest}{suffix}"));
            match fs::remove_file(&path) {
                Ok(()) => released = true,
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => eprintln!(
                    "omo-computer-engine: warn artifact release {}: {error}",
                    path.display()
                ),
            }
        }
        released
    }

    /// The timer sweep, once per [`SWEEP_INTERVAL_MS`] from the first tick.
    pub fn tick(&mut self, now_ms: u64) -> Option<SweepReport> {
        let due = *self.next_timer_ms.get_or_insert(now_ms + SWEEP_INTERVAL_MS);
        if now_ms < due {
            return None;
        }
        self.next_timer_ms = Some(now_ms + SWEEP_INTERVAL_MS);
        Some(self.sweep(now_ms, SweepTrigger::Timer))
    }

    /// The age sweep, then the cap sweep down to 80 % of each cap.
    pub fn sweep(&mut self, now_ms: u64, trigger: SweepTrigger) -> SweepReport {
        let mut warnings = Vec::new();
        let mut entries = self.entries(&mut warnings);
        let mut removed = 0;
        entries.retain(|entry| {
            let stale = now_ms.saturating_sub(entry.modified_ms) > self.limits.stale_ms;
            if stale {
                remove(entry, &mut warnings, &mut removed);
            }
            !stale
        });
        entries.sort_by_key(|entry| entry.modified_ms);
        let mut bytes: u64 = entries.iter().map(|entry| entry.bytes).sum();
        let mut files = entries.len() as u64;
        if bytes > self.limits.max_bytes || files > self.limits.max_files {
            let (byte_goal, file_goal) =
                (self.limits.max_bytes / 5 * 4, self.limits.max_files / 5 * 4);
            for entry in &entries {
                if bytes <= byte_goal && files <= file_goal {
                    break;
                }
                if remove(entry, &mut warnings, &mut removed) {
                    bytes -= entry.bytes;
                    files -= 1;
                }
            }
        }
        if !warnings.is_empty() {
            eprintln!(
                "omo-computer-engine: warn artifact sweep: {}",
                warnings.join("; ")
            );
        }
        let report = SweepReport {
            trigger,
            at_ms: now_ms,
            removed,
            bytes,
            files,
            warnings,
        };
        self.sweeps.push(report.clone());
        report
    }

    fn entries(&self, warnings: &mut Vec<String>) -> Vec<Entry> {
        let mut entries = Vec::new();
        for path in list(&self.dir, warnings) {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let prefixed =
                name.starts_with(ARTIFACT_PREFIX) && SUFFIXES.iter().any(|s| name.ends_with(s));
            if prefixed && path.is_file() {
                if let Some(entry) = file_entry(&path, warnings) {
                    entries.push(entry);
                }
            }
        }
        for session in list(&self.dir.join(SESSIONS_DIR), warnings) {
            if session.is_dir() {
                entries.push(dir_entry(session, warnings));
            }
        }
        entries
    }
}
