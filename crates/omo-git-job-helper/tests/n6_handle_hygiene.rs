//! N6 handle hygiene (design v4.2 section 20, I3, round-3 finding 5): no git member's handle table refers to F.
//! Object comparison, not a handle count, so a foreign holder (EDR, a viewer) cannot fail the row.
#![cfg(windows)]

mod support;

use std::process::{Command, Stdio};
use std::time::Duration;

use support::handles::{handle_count, object_type, scan_member};
use support::observer::Observer;
use support::op::{Launcher, Op};
use support::{example, job, process, scratch, unique, Receipt, EXIT_OK};

#[test]
fn n6_no_git_member_holds_a_handle_to_f() {
    let mut receipt = Receipt::new("N6");
    let git = process::find_on_path("git.exe").expect("git.exe on PATH is required for N6");
    let dir = scratch("n6");
    let repo = dir.join("repo");
    let init = Command::new(&git)
        .args(["init", "-q"])
        .arg(&repo)
        .status()
        .expect("git init");
    assert!(init.success(), "git init failed");
    let hooks = dir.join("hooks");
    std::fs::create_dir_all(&hooks).expect("hooks dir");
    let suffix = unique("n6");
    let blocker = example("testkit_blocker")
        .to_string_lossy()
        .replace('\\', "/");
    std::fs::write(
        hooks.join("commit-msg"),
        format!("#!/bin/sh\n\"{blocker}\" \"{suffix}\"\n"),
    )
    .expect("hook");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let f = job::open_query(&op.job()).expect("open F");
    let (type_name, job_type) = object_type(f.raw());
    let before = handle_count(f.raw());
    let hooks_path = format!(
        "core.hooksPath={}",
        hooks.to_string_lossy().replace('\\', "/")
    );
    let args = [
        "-c",
        hooks_path.as_str(),
        "-c",
        "user.name=n6",
        "-c",
        "user.email=n6@example.invalid",
        "-c",
        "core.fsmonitor=false",
        "commit",
        "--allow-empty",
        "-m",
        "n6",
    ];
    let spawned = op.go(&repo, &git, &args).expect("go");
    assert!(
        observer.wait_for(1, Duration::from_secs(60)),
        "the commit-msg hook never parked"
    );
    let after = handle_count(f.raw());
    receipt.line(format!("{spawned}; F type {type_name:?} index {job_type}; HandleCount before {before:?} after {after:?}"));
    assert_eq!(type_name, "Job", "{receipt}");
    let members: Vec<u32> = job::pid_list(f.raw())
        .into_iter()
        .filter(|&pid| pid != op.helper_pid)
        .collect();
    let mut saw_git = false;
    for pid in members {
        let scan = scan_member(pid, f.raw(), job_type);
        saw_git |= scan.image.to_ascii_lowercase().ends_with("git.exe");
        receipt.line(format!(
            "member {} {}: job handles {}, referring to F {}, re-enumerated {}",
            scan.pid, scan.image, scan.job_handles, scan.refers_to_f, scan.reenumerated
        ));
        assert_eq!(
            scan.refers_to_f, 0,
            "I3: a member holds a handle to F\n{receipt}"
        );
    }
    drop(f);
    assert!(saw_git, "no git.exe member was scanned\n{receipt}");
    observer.stop();
    let frames = op.frames_until("done", Duration::from_secs(60));
    receipt.line(format!("frames {frames:?}"));
    assert!(
        frames.is_ok_and(|frames| frames.iter().any(|frame| frame.starts_with("exit 0 "))),
        "{receipt}"
    );
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}
