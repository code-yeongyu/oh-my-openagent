//! N1 control (design v4.2 section 20): without kill-on-close, a job's name disappears while a member lives. This
//! documents why a missing name alone was never proof; it does not exercise the helper.
#![cfg(windows)]

mod support;

use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Duration;

use support::lines::Lines;
use support::observer::Observer;
use support::{example, job, job_name, process, unique, Receipt};

fn control(mode: &str) {
    let mut receipt = Receipt::new(format!("N1 control ({mode})"));
    let suffix = unique("n1");
    let observer = Observer::start(&suffix, None);
    let name = job_name(&unique("n1-job"));
    let blocker = example("testkit_blocker");
    let mut creator = Command::new(example("testkit_creator"))
        .args([name.as_str(), &blocker.to_string_lossy(), &suffix, mode])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn creator");
    let lines = Lines::new(creator.stdout.take().expect("creator stdout"));
    let spawned = lines
        .next(Duration::from_secs(10))
        .expect("creator never reported spawned");
    assert!(
        observer.wait_for(1, Duration::from_secs(10)),
        "the descendant never connected"
    );
    let (pid, descendant) = observer.with(|accepted| {
        (
            accepted[0].pid,
            accepted[0].process.as_ref().map(|owned| owned.raw()),
        )
    });
    let descendant = descendant.expect("SYNCHRONIZE handle on the descendant");
    receipt.line(format!(
        "creator {spawned:?}; descendant pid {pid} acknowledged over the pipe"
    ));
    let mut stdin = creator.stdin.take().expect("creator stdin");
    writeln!(stdin, "close").expect("send close");
    if mode == "close" {
        assert_eq!(
            lines.next(Duration::from_secs(10)).as_deref(),
            Some("closed"),
            "{receipt}"
        );
    } else {
        let status = creator.wait().expect("creator exit");
        receipt.line(format!("creator exited {status}"));
    }
    let gone = job::wait_gone(&name, Duration::from_secs(10)).is_some();
    let alive = !process::signaled_within(descendant, Duration::ZERO);
    receipt.line(format!("name NotFound={gone}; descendant alive={alive}"));
    let verdict = if gone && alive {
        "FALSIFIED"
    } else {
        "NOT_FALSIFIED"
    };
    receipt.line(format!("verdict {verdict}"));
    process::terminate(descendant);
    drop(stdin);
    let _reaped = creator.wait();
    assert_eq!(verdict, "FALSIFIED", "{receipt}");
}

#[test]
fn n1_name_is_gone_while_a_member_lives_after_the_creator_closes_its_handle() {
    control("close");
}

#[test]
fn n1_name_is_gone_while_a_member_lives_after_the_creator_dies() {
    control("die");
}
