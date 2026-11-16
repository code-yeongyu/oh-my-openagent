//! The self set, computed by the engine at every `session.open` (never a file) and again
//! whenever the list of sibling engines and brain sessions changes. Its baseline: the engine's
//! own pid chain to the session leader; every `omo-computer-*` process of the uid with, for a
//! sibling engine, its HOST CHAIN (`--host-pid` and its ancestors) and that host's TTY or
//! console owner; every omo brain process with no engine (found by its per-session lock file or
//! by name) with its TTY owner. The host's `selfSet` members are additive. The per-OS process
//! readers (rows 40, 50, 57) fill a [`ProcessSnapshot`].

mod brain;

use std::collections::BTreeSet;

pub use brain::{read_brain_locks, BrainLock, SESSION_LOCK_DIR};

use crate::gate::Identity;

/// Prefix of every engine, launcher and helper executable of the family.
pub const ENGINE_PREFIX: &str = "omo-computer-";

/// The brain executables the host ships names for; a host adapter registers more.
pub const BRAIN_NAMES: &[&str] = &["omo"];

/// One process as the per-OS reader sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    /// Process start time, to tell a recycled pid from its parent.
    pub start: u64,
    pub name: String,
    /// The controlling TTY / console, if any.
    pub tty: Option<u64>,
    /// The `--host-pid` argument the process was started with (engines only).
    pub host_pid: Option<u32>,
    pub session_leader: bool,
}

/// The processes of the uid and which process owns each TTY (its terminal emulator).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessSnapshot {
    pub processes: Vec<ProcessInfo>,
    pub tty_owners: Vec<(u64, u32)>,
}

impl ProcessSnapshot {
    fn get(&self, pid: u32) -> Option<&ProcessInfo> {
        self.processes.iter().find(|process| process.pid == pid)
    }

    fn tty_owner(&self, pid: u32) -> Option<u32> {
        let tty = self.get(pid)?.tty?;
        self.tty_owners
            .iter()
            .find(|(t, _)| *t == tty)
            .map(|(_, owner)| *owner)
    }
}

/// The host's additive members.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HostAdditions {
    pub pids: Vec<u32>,
    /// The omo desktop app's bundle id / AUMID / `WM_CLASS`.
    pub app_keys: Vec<String>,
}

/// What the self set is computed from.
#[derive(Debug, Clone, Copy)]
pub struct SelfSetInputs<'a> {
    pub own_pid: u32,
    pub snapshot: &'a ProcessSnapshot,
    pub brain_locks: &'a [BrainLock],
    pub brain_names: &'a [String],
    pub additions: &'a HostAdditions,
}

/// The processes and app identities the engine never drives.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SelfSet {
    pids: BTreeSet<u32>,
    app_keys: BTreeSet<String>,
}

impl SelfSet {
    #[must_use]
    pub fn compute(inputs: &SelfSetInputs<'_>) -> Self {
        let snapshot = inputs.snapshot;
        let mut set = Self::default();
        set.chain(snapshot, inputs.own_pid);
        for engine in snapshot
            .processes
            .iter()
            .filter(|p| p.name.starts_with(ENGINE_PREFIX))
        {
            set.pids.insert(engine.pid);
            if let Some(host) = engine.host_pid {
                set.chain(snapshot, host);
                set.pids.extend(snapshot.tty_owner(host));
            }
        }
        for brain in brains(inputs) {
            set.pids.insert(brain);
            set.pids.extend(snapshot.tty_owner(brain));
        }
        set.pids.extend(&inputs.additions.pids);
        set.app_keys
            .extend(inputs.additions.app_keys.iter().cloned());
        set
    }

    /// `pid` and its ancestors up to the session leader; a parent that started after its
    /// child is a recycled pid and ends the walk.
    fn chain(&mut self, snapshot: &ProcessSnapshot, pid: u32) {
        let mut current = pid;
        loop {
            if !self.pids.insert(current) {
                return;
            }
            let Some(process) = snapshot.get(current) else {
                return;
            };
            if process.session_leader || process.ppid == 0 {
                return;
            }
            match snapshot.get(process.ppid) {
                Some(parent) if parent.start <= process.start => current = parent.pid,
                Some(_) => return,
                None => {
                    self.pids.insert(process.ppid);
                    return;
                }
            }
        }
    }

    #[must_use]
    pub fn contains(&self, identity: &Identity) -> bool {
        self.pids.contains(&identity.pid)
            || self
                .app_keys
                .iter()
                .any(|key| key.eq_ignore_ascii_case(&identity.app_key))
    }

    #[must_use]
    pub fn contains_pid(&self, pid: u32) -> bool {
        self.pids.contains(&pid)
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.pids.is_empty() && self.app_keys.is_empty()
    }
}

/// The brain processes of the uid: a lock file whose pid and start match a live process, or a
/// process whose name is a brain name.
fn brains<'a>(inputs: &'a SelfSetInputs<'a>) -> impl Iterator<Item = u32> + 'a {
    let snapshot = inputs.snapshot;
    let locked = inputs.brain_locks.iter().filter_map(move |lock| {
        snapshot
            .get(lock.pid)
            .filter(|process| process.start == lock.process_start)
            .map(|process| process.pid)
    });
    let named = snapshot
        .processes
        .iter()
        .filter(move |process| {
            BRAIN_NAMES.contains(&process.name.as_str())
                || inputs.brain_names.iter().any(|name| name == &process.name)
        })
        .map(|process| process.pid);
    locked.chain(named)
}

/// The key the self set is recomputed on: the pids of every sibling engine and brain.
#[must_use]
pub fn watch_key(snapshot: &ProcessSnapshot, brain_locks: &[BrainLock]) -> BTreeSet<u32> {
    snapshot
        .processes
        .iter()
        .filter(|p| p.name.starts_with(ENGINE_PREFIX) || BRAIN_NAMES.contains(&p.name.as_str()))
        .map(|p| p.pid)
        .chain(brain_locks.iter().map(|lock| lock.pid))
        .collect()
}

#[cfg(test)]
mod tests;
