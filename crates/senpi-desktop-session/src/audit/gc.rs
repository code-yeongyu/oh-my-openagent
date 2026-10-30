//! Screenshot artifact GC: delete `senpi-computer-*.png` in the artifact
//! directory whose mtime is older than `stale_ms`. Foreign names are never
//! touched. Best-effort: IO errors are logged to stderr and never fail the
//! caller. `now_ms` is injected so tests do not depend on wall time.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::time::UNIX_EPOCH;

use senpi_desktop_core::types::ScreenshotGc;

use super::warn;

/// Prefix of every screenshot artifact this engine writes.
pub(crate) const ARTIFACT_PREFIX: &str = "senpi-computer-";
const ARTIFACT_SUFFIX: &str = ".png";

#[derive(Debug, Default)]
pub(crate) struct ArtifactGc {
    last_scan_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Sweep {
    pub scanned: u32,
    pub removed: u32,
}

impl ArtifactGc {
    pub(crate) fn maybe_run(&mut self, dir: &Path, now_ms: u64, knobs: ScreenshotGc) -> Sweep {
        if let Some(last) = self.last_scan_ms {
            if now_ms.saturating_sub(last) < knobs.scan_interval_ms {
                return Sweep::default();
            }
        }
        self.last_scan_ms = Some(now_ms);
        sweep(dir, now_ms, knobs.stale_ms)
    }
}

pub(crate) fn sweep(dir: &Path, now_ms: u64, stale_ms: u64) -> Sweep {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Sweep::default(),
        Err(error) => {
            warn(format_args!(
                "screenshot GC failed to read {} : {error}",
                dir.display()
            ));
            return Sweep::default();
        }
    };
    let mut result = Sweep::default();
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if !kind.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !is_artifact_png(name) {
            continue;
        }
        result.scanned = result.scanned.saturating_add(1);
        let path = entry.path();
        let Some(mtime_ms) = mtime_ms(&path) else {
            continue;
        };
        if now_ms.saturating_sub(mtime_ms) <= stale_ms {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => result.removed = result.removed.saturating_add(1),
            Err(error) => warn(format_args!(
                "screenshot GC failed to remove {}: {error}",
                path.display()
            )),
        }
    }
    result
}

fn is_artifact_png(name: &str) -> bool {
    name.starts_with(ARTIFACT_PREFIX) && name.ends_with(ARTIFACT_SUFFIX)
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    u64::try_from(duration.as_millis()).ok()
}

#[cfg(test)]
#[path = "gc_test.rs"]
mod tests;
