//! `run` mode reports (design v4.2 sections 6.1, 7.2, 9, 10.2): exit/empty/lingering, done, the linger kill,
//! `terminate-root` and a failed spawn.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::Duration;

use support::observer::Observer;
use support::op::{Launcher, Op};
use support::{
    example, job, process, scratch, unique, Receipt, EXIT_OK, EXIT_SPAWN_FAILED, LINGER_KILL_CODE,
};

#[test]
fn run_reports_the_root_exit_then_done() {
    let mut receipt = Receipt::new("run plain");
    let dir = scratch("run");
    let sentinel = dir.join("sentinel");
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let spawned = op
        .go(
            &dir,
            &example("testkit_touch"),
            &[&sentinel.to_string_lossy()],
        )
        .expect("go");
    let frames = op.frames_until("done", Duration::from_secs(30));
    receipt.line(format!("{spawned}; {frames:?}"));
    let frames = frames.unwrap_or_else(|error| panic!("{error}\n{receipt}"));
    assert!(
        frames
            .first()
            .is_some_and(|frame| frame.starts_with("exit 0 ")),
        "{receipt}"
    );
    assert!(sentinel.exists(), "{receipt}");
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}

fn detached_member(extra: &[&str]) -> (Op, Observer, String) {
    let suffix = unique("linger");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(extra, Launcher::Direct, Stdio::null()).expect("helper run");
    let blocker = example("testkit_blocker");
    op.go(
        &scratch("linger"),
        &example("testkit_detach"),
        &[&blocker.to_string_lossy(), &suffix],
    )
    .expect("go");
    let exit = op.frame(Duration::from_secs(30)).expect("exit frame");
    (op, observer, exit)
}

#[test]
fn run_reports_lingering_and_then_done_when_the_descendant_exits() {
    let mut receipt = Receipt::new("run lingering");
    let (mut op, observer, exit) = detached_member(&[]);
    receipt.line(format!("root exit frame {exit:?}"));
    assert_eq!(exit, "exit 0 lingering", "{receipt}");
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "descendant never connected"
    );
    observer.stop();
    let frames = op.frames_until("done", Duration::from_secs(30));
    receipt.line(format!("{frames:?}"));
    assert!(frames.is_ok(), "{receipt}");
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}

#[test]
fn run_kills_the_job_when_the_linger_budget_expires() {
    let mut receipt = Receipt::new("run linger expiry");
    let (mut op, observer, exit) = detached_member(&["--linger-ms", "2000"]);
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "descendant never connected"
    );
    let member = observer
        .with(|accepted| accepted[0].process.as_ref().map(|owned| owned.raw()))
        .expect("member handle");
    let expired = op.frame(Duration::from_secs(30));
    let member_dead = process::signaled_within(member, Duration::from_secs(10));
    let code = op.exited_within(Duration::from_secs(10));
    let gone = job::wait_gone(&op.job(), Duration::from_secs(10)).is_some();
    receipt.line(format!(
        "{exit:?} then {expired:?}; member dead {member_dead}; H exit {code:?}; name gone {gone}"
    ));
    assert_eq!(expired.as_deref(), Ok("linger-expired"), "{receipt}");
    assert!(member_dead && gone, "{receipt}");
    assert_eq!(code, Some(LINGER_KILL_CODE), "{receipt}");
}

#[test]
fn terminate_root_kills_the_root_only_and_the_operation_completes() {
    let mut receipt = Receipt::new("run terminate-root");
    let suffix = unique("terminate");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    op.go(
        &scratch("terminate"),
        &example("testkit_blocker"),
        &[&suffix],
    )
    .expect("go");
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "root never connected"
    );
    op.pipe.write(b"terminate-root\n").expect("terminate-root");
    let frames = op.frames_until("done", Duration::from_secs(30));
    receipt.line(format!("{frames:?}"));
    let frames = frames.unwrap_or_else(|error| panic!("{error}\n{receipt}"));
    assert!(
        frames
            .first()
            .is_some_and(|frame| frame.starts_with("exit 1 ")),
        "{receipt}"
    );
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}

#[test]
fn a_failed_spawn_is_reported_and_nothing_runs() {
    let mut receipt = Receipt::new("run spawn-failed");
    let dir = scratch("spawn-failed");
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let frame = op.go(&dir, &dir.join("missing.exe"), &[]);
    let code = op.exited_within(Duration::from_secs(10));
    receipt.line(format!("{frame:?}; exit {code:?}"));
    assert!(
        frame
            .as_deref()
            .is_ok_and(|line| line.starts_with("spawn-failed ")),
        "{receipt}"
    );
    assert_eq!(code, Some(EXIT_SPAWN_FAILED), "{receipt}");
}
