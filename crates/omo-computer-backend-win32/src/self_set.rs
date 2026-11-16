//! The Windows reader of the self set (d-windows.md '## Identity and permissions', self set): every
//! process of the SID with its parent (`InheritedFromUniqueProcessId`), its creation time (so a
//! recycled parent pid is never followed - the safety crate's chain rule compares them), its image,
//! its console, and the `--host-pid` a sibling engine was started with; each console's owner is the
//! terminal that hosts it (`GetConsoleProcessList`). The rules themselves are the safety crate's.

use omo_computer_safety::self_set::{ProcessInfo, ProcessSnapshot};

/// One process as the Windows enumeration reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawProcess {
    pub pid: u32,
    pub ppid: u32,
    /// `GetProcessTimes` creation time.
    pub start: u64,
    /// The full image path.
    pub image: String,
    /// The console the process is attached to, if any.
    pub console: Option<u64>,
    pub command_line: String,
}

/// The `--host-pid` argument of an engine's command line.
#[must_use]
pub fn host_pid_of(command_line: &str) -> Option<u32> {
    let mut words = command_line.split_whitespace();
    while let Some(word) = words.next() {
        if word == "--host-pid" {
            return words.next()?.parse().ok();
        }
        if let Some(value) = word.strip_prefix("--host-pid=") {
            return value.parse().ok();
        }
    }
    None
}

fn image_name(image: &str) -> String {
    image.rsplit(['\\', '/']).next().unwrap_or(image).to_owned()
}

/// The snapshot the safety crate computes the self set from; `console_owners` pairs each console
/// with the pid of the terminal that owns it.
#[must_use]
pub fn snapshot(processes: &[RawProcess], console_owners: &[(u64, u32)]) -> ProcessSnapshot {
    ProcessSnapshot {
        processes: processes
            .iter()
            .map(|raw| ProcessInfo {
                pid: raw.pid,
                ppid: raw.ppid,
                start: raw.start,
                name: image_name(&raw.image),
                tty: raw.console,
                host_pid: host_pid_of(&raw.command_line),
                session_leader: false,
            })
            .collect(),
        tty_owners: console_owners.to_vec(),
    }
}
