//! A-IS-62 R7-3 / R7-7: every writer takes the hand's lock and checks the file's size under it,
//! so two writers that both find the file under the hard cap never take it past
//! `hard_cap + max_event` together.

use std::fs::{self, File, OpenOptions};
use std::path::Path;

use crate::audit::{AuditEvent, AuditLimits, AuditSink, AuditWriter, WriterId};

const LIMITS: AuditLimits = AuditLimits {
    rotate_at: 1 << 20,
    hard_cap: 1_000,
    max_event: 400,
};

/// A line of about 390 bytes once stamped: under `max_event`, two of them over the slack.
fn padded() -> AuditEvent {
    AuditEvent {
        action: "click".to_owned(),
        target: "window:101".to_owned(),
        evidence: vec!["x".repeat(185)],
        ..AuditEvent::default()
    }
}

fn writer(dir: &Path, pid: u32) -> AuditWriter {
    let id = WriterId {
        pid,
        proc_start_ms: 1,
    };
    AuditWriter::open(dir, "hand-1", 1, id, LIMITS).expect("writer")
}

fn hold(path: &Path) -> File {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .expect("lock target");
    file.lock().expect("held by the test");
    file
}

#[cfg(unix)]
fn inode(path: &Path) -> u64 {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).expect("stat").ino()
}

/// The flock requests blocked on `inodes`, as the kernel lists them (`->` rows of /proc/locks).
#[cfg(target_os = "linux")]
fn blocked_on(inodes: &[u64]) -> usize {
    let locks = fs::read_to_string("/proc/locks").expect("/proc/locks");
    locks
        .lines()
        .filter(|line| line.contains("->"))
        .filter(|line| {
            inodes
                .iter()
                .any(|ino| line.split_whitespace().any(|field| field.ends_with(&format!(":{ino}"))))
        })
        .count()
}

#[cfg(target_os = "linux")]
#[test]
fn two_writers_at_the_hard_cap_never_take_the_file_past_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut first = writer(dir.path(), 11);
    let mut second = writer(dir.path(), 12);
    let file = first.path().to_owned();
    let opened = fs::metadata(&file).expect("stat").len();
    first.append(padded()).expect("one line under the cap");
    let size = fs::metadata(&file).expect("stat").len();
    let line = size - opened;
    assert!(line <= LIMITS.max_event && size < LIMITS.hard_cap, "both writers start under the cap: {size}, line {line}");
    assert!(size + 2 * line > LIMITS.hard_cap + LIMITS.max_event, "two more lines would overshoot: {size}, line {line}");
    // The test holds every lock a writer could wait on (the data file and the hand's lock), so
    // both writers are parked in the kernel before either writes.
    let lock = file.with_file_name("audit.lock");
    let held = (hold(&file), hold(&lock));
    let inodes = [inode(&file), inode(&lock)];
    let threads = [
        std::thread::spawn(move || first.append(padded()).is_ok()),
        std::thread::spawn(move || second.append(padded()).is_ok()),
    ];
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    // The kernel's own list of blocked lock requests is the only signal there is for "parked".
    while blocked_on(&inodes) < 2 {
        assert!(std::time::Instant::now() < deadline, "both writers wait on a lock");
        std::thread::yield_now();
    }
    drop(held);
    let written: Vec<bool> = threads
        .into_iter()
        .map(|thread| thread.join().expect("writer thread"))
        .collect();
    let size = fs::metadata(&file).expect("stat").len();
    assert!(
        size <= LIMITS.hard_cap + LIMITS.max_event,
        "the file stays at or under hard_cap + max_event: {size} bytes, writes {written:?}"
    );
    assert_eq!(written.iter().filter(|ok| **ok).count(), 1, "one writer wrote, the other was refused at the cap");
}
