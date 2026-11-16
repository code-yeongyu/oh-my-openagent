//! The engine's own ancestry for the self set (row 28, DEFERRED-LEGS C12 "the MCP profile case"):
//! every process from the engine up to its session leader - which already holds the MCP client and
//! the terminal that launched it - so a host-less engine refuses `SelfTarget` on them without any
//! host addition. Linux reads `/proc/<pid>/stat`; macOS (row 40) and Windows (row 60) readers are
//! owed legs, and until they land those OSes report the engine alone, as before.

use crate::self_set::ProcessInfo;

/// A walk longer than this is a loop in a recycled-pid table, not a real ancestry.
#[cfg(target_os = "linux")]
const MAX_DEPTH: usize = 64;

#[cfg(target_os = "linux")]
fn read(pid: u32) -> Option<ProcessInfo> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_stat(pid, &stat)
}

/// `/proc/<pid>/stat`: the name sits in parentheses and may hold spaces, so fields are counted
/// after the LAST `)`. Then: state ppid pgrp session tty_nr ... starttime (field 22).
#[cfg(any(target_os = "linux", test))]
fn parse_stat(pid: u32, stat: &str) -> Option<ProcessInfo> {
    let open = stat.find('(')?;
    let close = stat.rfind(')')?;
    let name = stat.get(open + 1..close)?.to_owned();
    let fields: Vec<&str> = stat.get(close + 1..)?.split_whitespace().collect();
    let field = |n: usize| fields.get(n - 3).copied();
    let ppid = field(4)?.parse().ok()?;
    let session: u32 = field(6)?.parse().ok()?;
    let tty: u64 = field(7)?.parse().ok()?;
    let start = field(22)?.parse().ok()?;
    Some(ProcessInfo {
        pid,
        ppid,
        start,
        name,
        tty: (tty != 0).then_some(tty),
        host_pid: None,
        session_leader: session == pid,
    })
}

/// The engine and its ancestors up to the session leader, child first.
#[cfg(target_os = "linux")]
pub fn own_chain() -> Vec<ProcessInfo> {
    let mut chain = Vec::new();
    let mut pid = std::process::id();
    while chain.len() < MAX_DEPTH {
        let Some(process) = read(pid) else { break };
        let (next, last) = (process.ppid, process.session_leader || process.ppid <= 1);
        chain.push(process);
        if last {
            break;
        }
        pid = next;
    }
    chain
}

#[cfg(not(target_os = "linux"))]
pub fn own_chain() -> Vec<ProcessInfo> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_with_spaces_and_parentheses_still_parses() {
        let stat = "4242 (my (odd) name) S 4000 4242 3999 34817 0 0 0 0 0 0 0 0 0 0 20 0 1 0 98765 0 0";
        let process = parse_stat(4242, stat).expect("parsed");
        assert_eq!((process.ppid, process.start, process.name.as_str()), (4000, 98_765, "my (odd) name"));
        assert_eq!(process.tty, Some(34_817));
        assert!(!process.session_leader);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_chain_starts_at_this_process_and_reaches_its_parent() {
        let chain = own_chain();
        assert_eq!(chain.first().map(|p| p.pid), Some(std::process::id()));
        if let Some(first) = chain.first().filter(|p| !p.session_leader) {
            assert!(chain.iter().any(|p| p.pid == first.ppid), "{chain:?}");
        }
    }
}
