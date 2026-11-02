//! N10 (design v4.2 section 7.2, round-3 finding 6): `AWAIT_GO` has no timer; it ends only on `go`, `cancel`, a
//! malformed frame or EOF.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::Duration;

use support::op::{Launcher, Op};
use support::{example, job, scratch, Receipt, EXIT_CANCELLED, EXIT_OK};

#[test]
fn n10_a_silent_writer_keeps_h_waiting_past_the_gate_and_probe_bounds() {
    let mut receipt = Receipt::new("N10 silent");
    let dir = scratch("n10");
    let sentinel = dir.join("sentinel");
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    // The absence of a timer is the behavior under test: 25 s exceeds the gate wait plus the probe timeout (10 + 10 s).
    std::thread::sleep(Duration::from_secs(25));
    let alive = op.exited_within(Duration::ZERO).is_none();
    let f = job::open_query(&op.job()).expect("open F");
    let (active, pids) = (
        job::accounting(f.raw()).map(|info| info.ActiveProcesses),
        job::pid_list(f.raw()),
    );
    drop(f);
    receipt.line(format!(
        "after 25 s: H alive {alive}; F active {active:?}; pids {pids:?}; sentinel {}",
        sentinel.exists()
    ));
    assert!(
        alive && active == Some(1) && pids == [op.helper_pid] && !sentinel.exists(),
        "{receipt}"
    );
    let spawned = op
        .go(
            &dir,
            &example("testkit_touch"),
            &[&sentinel.to_string_lossy()],
        )
        .expect("go");
    let frames = op.frames_until("done", Duration::from_secs(30));
    receipt.line(format!(
        "{spawned}; frames {frames:?}; sentinel {}",
        sentinel.exists()
    ));
    assert!(
        spawned.starts_with("spawned ") && frames.is_ok() && sentinel.exists(),
        "{receipt}"
    );
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}

fn ended_before_go(ending: Option<&[u8]>) {
    let mut receipt = Receipt::new(format!(
        "N10 ending {:?}",
        ending.map(String::from_utf8_lossy)
    ));
    let dir = scratch("n10");
    let sentinel = dir.join("sentinel");
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    op.exec(
        &dir,
        &example("testkit_touch"),
        &[&sentinel.to_string_lossy()],
    )
    .expect("exec frame");
    match ending {
        Some(frame) => {
            op.pipe.write(frame).expect("frame");
            let reply = op.frame(Duration::from_secs(10));
            receipt.line(format!("reply {reply:?}"));
            assert_eq!(reply.as_deref(), Ok("cancelled"), "{receipt}");
        }
        None => op.disconnect(),
    }
    let code = op.exited_within(Duration::from_secs(10));
    receipt.line(format!("exit {code:?}; sentinel {}", sentinel.exists()));
    assert_eq!(code, Some(EXIT_CANCELLED), "{receipt}");
    assert!(!sentinel.exists(), "{receipt}");
}

#[test]
fn n10_eof_before_go_exits_without_running_git() {
    ended_before_go(None);
}

#[test]
fn n10_cancel_before_go_exits_without_running_git() {
    ended_before_go(Some(b"cancel\n"));
}

#[test]
fn n10_a_malformed_frame_before_go_means_cancel() {
    ended_before_go(Some(b"bogus\n"));
}
