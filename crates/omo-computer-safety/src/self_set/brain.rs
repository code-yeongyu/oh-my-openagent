//! The per-session lock files the local hand tool host writes under the per-uid RUNTIME root
//! (`sessions/<pid>.lock`, each naming its pid and process start): how the engine finds an omo
//! brain that has spawned no engine.

use std::path::Path;

use serde::Deserialize;

/// The lock directory under the RUNTIME root.
pub const SESSION_LOCK_DIR: &str = "sessions";

/// One brain session's lock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainLock {
    pub pid: u32,
    pub process_start: u64,
}

/// Every well-formed `sessions/<pid>.lock` under `runtime_root`; a file whose name and
/// content disagree on the pid, or that does not parse, is skipped.
#[must_use]
pub fn read_brain_locks(runtime_root: &Path) -> Vec<BrainLock> {
    let Ok(entries) = std::fs::read_dir(runtime_root.join(SESSION_LOCK_DIR)) else {
        return Vec::new();
    };
    let mut locks: Vec<BrainLock> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let pid: u32 = name.to_str()?.strip_suffix(".lock")?.parse().ok()?;
            let text = std::fs::read_to_string(entry.path()).ok()?;
            let lock: BrainLock = serde_json::from_str(&text).ok()?;
            (lock.pid == pid).then_some(lock)
        })
        .collect();
    locks.sort_by_key(|lock| lock.pid);
    locks
}
