//! The X11 self set's process reads (design row L9): every process of the engine's uid from
//! `/proc/<pid>/stat` (parent, session, `tty_nr`, start time), the `--host-pid` an engine was
//! started with, and the terminal emulator that owns each TTY - the parent of the TTY's session
//! leader. The safety crate turns this into the self set, so a window whose `_NET_WM_PID` is the
//! user's terminal, a sibling engine's host chain or the engine itself is refused `SelfTarget`.

use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use omo_computer_core::backend::{ProcessRow, ProcessTable};

/// The fields of one `/proc/<pid>/stat` line the self set needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Stat {
    pub pid: u32,
    pub name: String,
    pub ppid: u32,
    pub session: u32,
    pub tty_nr: u64,
    pub start: u64,
}

/// Parses a `stat` line; the name is everything between the first `(` and the LAST `)`, since a
/// process may put parentheses and spaces in its own name.
#[must_use]
pub fn parse_stat(line: &str) -> Option<Stat> {
    let open = line.find('(')?;
    let close = line.rfind(')')?;
    let pid = line.get(..open)?.trim().parse().ok()?;
    let name = line.get(open + 1..close)?.to_owned();
    let rest: Vec<&str> = line.get(close + 1..)?.split_whitespace().collect();
    let field = |n: usize| rest.get(n - 3).copied();
    Some(Stat {
        pid,
        name,
        ppid: field(4)?.parse().ok()?,
        session: field(6)?.parse().ok()?,
        tty_nr: field(7)?.parse().ok()?,
        start: field(22)?.parse().ok()?,
    })
}

/// The value of `--host-pid` in a NUL-separated command line.
#[must_use]
pub fn host_pid(cmdline: &[u8]) -> Option<u32> {
    let args: Vec<&[u8]> = cmdline.split(|byte| *byte == 0).collect();
    args.iter().enumerate().find_map(|(index, arg)| {
        let text = std::str::from_utf8(arg).ok()?;
        let value = match text.strip_prefix("--host-pid") {
            Some("") => std::str::from_utf8(args.get(index + 1)?).ok()?,
            Some(rest) => rest.strip_prefix('=')?,
            None => return None,
        };
        value.parse().ok()
    })
}

/// The processes of `uid` under `root` (normally `/proc`) and the owner of each TTY.
#[must_use]
pub fn read_processes(root: &Path, uid: u32) -> ProcessTable {
    let Ok(entries) = fs::read_dir(root) else {
        return ProcessTable::default();
    };
    let mut stats = Vec::new();
    let mut hosts = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        let owned = fs::metadata(&dir).is_ok_and(|meta| meta.uid() == uid);
        let stat = fs::read_to_string(dir.join("stat"))
            .ok()
            .and_then(|line| parse_stat(&line));
        if let (true, Some(stat)) = (owned, stat) {
            hosts.push(
                fs::read(dir.join("cmdline"))
                    .ok()
                    .and_then(|line| host_pid(&line)),
            );
            stats.push(stat);
        }
    }
    table(&stats, &hosts)
}

fn table(stats: &[Stat], hosts: &[Option<u32>]) -> ProcessTable {
    let mut tty_owners: Vec<(u64, u32)> = stats
        .iter()
        .filter(|stat| stat.tty_nr != 0 && stat.pid == stat.session)
        .map(|leader| (leader.tty_nr, leader.ppid))
        .collect();
    tty_owners.sort_unstable();
    tty_owners.dedup_by_key(|(tty, _)| *tty);
    ProcessTable {
        processes: stats
            .iter()
            .zip(hosts)
            .map(|(stat, host)| ProcessRow {
                pid: stat.pid,
                ppid: stat.ppid,
                start: stat.start,
                name: stat.name.clone(),
                tty: (stat.tty_nr != 0).then_some(stat.tty_nr),
                host_pid: *host,
                session_leader: stat.pid == stat.session,
            })
            .collect(),
        tty_owners,
    }
}
