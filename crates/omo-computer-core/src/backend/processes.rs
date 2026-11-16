//! The process table a backend reads from its OS for the self set (R62, row 50).

/// One process of the uid as the OS reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessRow {
    pub pid: u32,
    pub ppid: u32,
    /// Start time, to tell a recycled pid from its parent.
    pub start: u64,
    pub name: String,
    /// The controlling TTY device number, if any.
    pub tty: Option<u64>,
    /// The `--host-pid` argument an engine was started with.
    pub host_pid: Option<u32>,
    pub session_leader: bool,
}

/// The processes and which process owns each TTY (its terminal emulator).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessTable {
    pub processes: Vec<ProcessRow>,
    pub tty_owners: Vec<(u64, u32)>,
}
