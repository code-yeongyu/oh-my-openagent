//! N5 (design v4.2 section 20, I2): F carries exactly KILL_ON_JOB_CLOSE and no breakaway; a member's
//! `CREATE_BREAKAWAY_FROM_JOB` create fails and no process exists.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::Duration;

use support::lines::Lines;
use support::op::{Launcher, Op};
use support::{example, job, process, scratch, unique, Receipt, EXIT_OK};
use windows_sys::Win32::System::JobObjects::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

#[test]
fn n5_limits_read_back_exactly_and_a_breakaway_create_fails() {
    let mut receipt = Receipt::new("N5");
    let dir = scratch("n5");
    let child_image = format!("{}.exe", unique("n5-child"));
    let child = dir.join(&child_image);
    std::fs::copy(example("testkit_touch"), &child).expect("copy child image");
    let sentinel = dir.join("sentinel");
    let mut op = Op::start(&[], Launcher::Direct, Stdio::piped()).expect("helper run");
    let lines = Lines::new(
        op.launcher
            .as_mut()
            .and_then(|launcher| launcher.stdout.take())
            .expect("helper stdout"),
    );
    let f = job::open_query(&op.job()).expect("open F");
    let flags = job::limit_flags(f.raw());
    drop(f);
    receipt.line(format!("LimitFlags {flags:?}"));
    assert_eq!(flags, Some(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE), "{receipt}");
    let spawned = op
        .go(
            &dir,
            &example("testkit_breakaway"),
            &[&child.to_string_lossy(), &sentinel.to_string_lossy()],
        )
        .expect("go");
    let outcome = lines.next(Duration::from_secs(30)).unwrap_or_default();
    let frames = op.frames_until("done", Duration::from_secs(30));
    let survivors = process::live_by_image(&child_image);
    receipt.line(format!("{spawned}; member said {outcome:?}; frames {frames:?}; survivors {survivors:?}; sentinel {}", sentinel.exists()));
    assert!(outcome.starts_with("breakaway ok=0"), "{receipt}");
    assert!(survivors.is_empty() && !sentinel.exists(), "{receipt}");
    assert!(frames.is_ok(), "{receipt}");
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}
