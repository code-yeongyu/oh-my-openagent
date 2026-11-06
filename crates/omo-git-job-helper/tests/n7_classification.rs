//! N7 classification (design v4.2 sections 6.2 and 20; R10): every probe answer comes from an in-frame code.
#![cfg(windows)]

mod support;

use std::process::Command;
use std::time::Duration;

use support::lines::run_bounded;
use support::win::{creation_time, spawn};
use support::{example, helper_exe, job, job_name, process, scratch, sddl, unique, Receipt};
use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
use windows_sys::Win32::System::Threading::GetCurrentProcess;

fn exited(dir: &std::path::Path, tag: &str) -> (support::win::Owned, u32, u64) {
    let (handle, pid) = spawn(
        &example("testkit_touch"),
        &[&dir.join(tag).to_string_lossy()],
        0,
    )
    .expect("spawn touch");
    assert!(
        process::signaled_within(handle.raw(), Duration::from_secs(30)),
        "touch did not exit"
    );
    let created = creation_time(handle.raw()).expect("creation time");
    (handle, pid, created)
}

#[test]
fn n7_probe_classifies_helper_and_job_states() {
    let mut receipt = Receipt::new("N7");
    let dir = scratch("n7");
    // SAFETY: the pseudo-handle names this process.
    let own = creation_time(unsafe { GetCurrentProcess() }).expect("own creation time");
    let me = std::process::id();
    let (held, held_pid, held_ft) = exited(&dir, "held");
    let (closed, closed_pid, closed_ft) = exited(&dir, "closed");
    drop(closed);
    let (gone, denied, empty, busy) = (
        unique("n7-gone"),
        unique("n7-denied"),
        unique("n7-empty"),
        unique("n7-busy"),
    );
    let deny = format!("D:(D;;GA;;;{})(A;;GA;;;SY)", sddl::current_user_sid());
    let (denied_job, _) = job::create(&job_name(&denied), Some(&deny));
    let (empty_job, _) = job::create(&job_name(&empty), None);
    let (busy_job, _) = job::create(&job_name(&busy), None);
    let busy_job = busy_job.expect("busy job");
    let (member, _) =
        spawn(&example("testkit_blocker"), &[&unique("n7-nobody")], 0).expect("spawn member");
    // SAFETY: both handles are live; the test created the job and owns the member.
    assert!(
        unsafe { AssignProcessToJobObject(busy_job.raw(), member.raw()) } != 0,
        "assign member"
    );
    let gate = dir.join("git-activity.gate");
    std::fs::write(&gate, b"").expect("gate file");
    let input = format!(
        "entry {me} {own} {gone}\nentry {me} {} {gone}\nentry {held_pid} {held_ft} {gone}\nentry {closed_pid} {closed_ft} {gone}\n\
         entry {held_pid} {held_ft} {denied}\nentry {held_pid} {held_ft} {empty}\nentry {held_pid} {held_ft} {busy}\nentry x y z\ngate {}\n",
        own + 1,
        gate.display()
    );
    let mut command = Command::new(helper_exe());
    command.arg("probe");
    let (code, stdout, stderr) = run_bounded(command, input.as_bytes(), Duration::from_secs(30));
    receipt.line(format!("exit {code:?}; stderr {stderr:?}"));
    for line in stdout.lines() {
        receipt.line(line.to_owned());
    }
    let lines: Vec<&str> = stdout.lines().collect();
    let expect = |index: usize, parts: &[&str]| {
        let line = lines.get(index).copied().unwrap_or_default();
        for part in parts {
            assert!(
                line.split(' ').any(|token| token.starts_with(part)),
                "entry {index} lacks {part:?}: {line:?}\n{receipt}"
            );
        }
    };
    expect(0, &["helper=alive", "job=skipped", "verdict=busy"]);
    expect(
        1,
        &["helper=dead:pid-reused", "job=gone", "verdict=reclaimable"],
    );
    expect(
        2,
        &["helper=dead:exited", "job=gone", "verdict=reclaimable"],
    );
    expect(3, &["helper=dead:", "job=gone", "verdict=reclaimable"]);
    expect(
        4,
        &["helper=dead:exited", "job=unknown:5", "verdict=unknown"],
    );
    expect(
        5,
        &["helper=dead:exited", "job=active:0", "verdict=reclaimable"],
    );
    expect(6, &["helper=dead:exited", "job=active:1", "verdict=busy"]);
    expect(7, &["malformed", "verdict=unknown"]);
    assert_eq!(lines.get(8).copied(), Some("volume fixed"), "{receipt}");
    assert_eq!(code, Some(0), "{receipt}");
    process::terminate(member.raw());
    drop((held, denied_job, empty_job));
}
