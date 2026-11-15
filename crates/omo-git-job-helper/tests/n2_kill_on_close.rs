//! N2 (a) and (c) (design v4.2 section 20, I4/I5): killing H closes F's only handle, so the name goes away and every
//! member, including a Bun child's nested libuv job and its grandchild, is terminated.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::Duration;

use support::observer::Observer;
use support::op::{Launcher, Op};
use support::{example, job, process, scratch, unique, Receipt};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::JobObjects::IsProcessInJob;

fn kill_and_settle(op: &Op, members: &[(&str, HANDLE)], receipt: &mut Receipt) {
    op.kill();
    assert!(
        process::signaled_within(op.helper.raw(), Duration::from_secs(10)),
        "H did not die\n{receipt}"
    );
    let gone = job::wait_gone(&op.job(), Duration::from_secs(10));
    receipt.line(format!(
        "after H signaled: name NotFound={}",
        gone.is_some()
    ));
    let gone = gone.unwrap_or_else(|| panic!("F's name survived H\n{receipt}"));
    for (label, member) in members {
        let bound = Duration::from_secs(10).saturating_sub(gone.elapsed());
        let signaled = process::signaled_within(*member, bound);
        receipt.line(format!(
            "{label} signaled within 10 s of NotFound: {signaled}"
        ));
        assert!(signaled, "{label} outlived F\n{receipt}");
    }
}

#[test]
fn n2a_a_member_blocked_in_a_pipe_read_dies_with_h() {
    let mut receipt = Receipt::new("N2(a)");
    let suffix = unique("n2a");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let spawned = op
        .go(&scratch("n2a"), &example("testkit_blocker"), &[&suffix])
        .expect("go");
    let root = Op::spawned_pid(&spawned);
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "member never connected"
    );
    let member = observer.with(|accepted| {
        assert_eq!(
            accepted[0].pid, root,
            "the connected member is the spawned root"
        );
        accepted[0]
            .process
            .as_ref()
            .map(|owned| owned.raw())
            .expect("member handle")
    });
    receipt.line(format!("root {spawned}"));
    kill_and_settle(&op, &[("member", member)], &mut receipt);
}

#[test]
fn n2c_a_bun_child_with_a_nested_libuv_job_and_a_grandchild_dies_with_h() {
    let mut receipt = Receipt::new("N2(c)");
    let bun = std::env::var_os("OMO_TEST_BUN")
        .map(std::path::PathBuf::from)
        .or_else(|| process::find_on_path("bun.exe"))
        .expect("bun.exe is required for N2(c): a missing capability fails, it is never skipped");
    let dir = scratch("n2c");
    let script = dir.join("n2c.js");
    std::fs::write(&script, "Bun.spawn([process.argv[2], process.argv[3]], { stdio: [\"ignore\", \"ignore\", \"ignore\"] });\nsetInterval(() => {}, 1 << 30);\n").expect("script");
    let suffix = unique("n2c");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let blocker = example("testkit_blocker");
    let spawned = op
        .go(
            &dir,
            &bun,
            &[
                &script.to_string_lossy(),
                &blocker.to_string_lossy(),
                &suffix,
            ],
        )
        .expect("go");
    let root = process::open(Op::spawned_pid(&spawned), process::WATCH).expect("bun root handle");
    assert!(
        observer.wait_for(1, Duration::from_secs(60)),
        "the grandchild never connected"
    );
    let grandchild = observer
        .with(|accepted| accepted[0].process.as_ref().map(|owned| owned.raw()))
        .expect("grandchild handle");
    let f = job::open_query(&op.job()).expect("open F");
    let mut in_f = 0;
    // SAFETY: both handles are live; `in_f` is a writable BOOL.
    unsafe { IsProcessInJob(grandchild, f.raw(), &mut in_f) };
    drop(f);
    receipt.line(format!(
        "bun root {spawned}; grandchild IsProcessInJob(F)={}",
        in_f != 0
    ));
    assert!(
        in_f != 0,
        "the grandchild of a Bun member is not an F member\n{receipt}"
    );
    kill_and_settle(
        &op,
        &[("bun root", root.raw()), ("grandchild", grandchild)],
        &mut receipt,
    );
}
