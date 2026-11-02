use super::*;
use crate::FakeClock;
use std::{
    io::Write,
    process::Stdio,
    sync::{Barrier, mpsc},
    time::Duration,
};

#[test]
fn r3_release_timeout_child() {
    if std::env::var_os("SENPI_TEST_STUCK_RELEASE").is_none() {
        return;
    }
    let supervisor = Arc::new(Supervisor::with_stop_commit(
        Arc::new(FakeClock::new(0)),
        false,
        || {
            println!("R3_TIMEOUT_PERSISTED");
            std::io::stdout().flush().unwrap();
        },
    ));
    let signal = supervisor.hold_signal();
    let blocked = Arc::clone(&supervisor);
    let barrier = Barrier::new(2);
    let (entered, ready) = mpsc::channel();
    std::thread::spawn(move || {
        signal.with_input(&blocked, || {
            entered.send(()).unwrap();
            barrier.wait();
            Ok(())
        })
    });
    ready.recv_timeout(Duration::from_secs(5)).unwrap();
    supervisor.trigger_stop(StopSource::Hotkey);
    panic!("timed-out release returned an acknowledgement");
}

#[tokio::test]
async fn r3_stuck_release_persists_and_exits_without_acknowledgement() {
    // given: a real child with preparation blocked until process termination.
    let mut child = tokio::process::Command::new(std::env::current_exe().unwrap());
    child
        .args([
            "--exact",
            "supervisor::stop_timeout_tests::r3_release_timeout_child",
            "--nocapture",
        ])
        .env("SENPI_TEST_STUCK_RELEASE", "1")
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // when: kill-on-drop also cleans up the old unbounded implementation on RED.
    let output = tokio::time::timeout(Duration::from_secs(5), child.output()).await;
    // then
    let output = output
        .expect("stop did not persist and exit within its release bound")
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    let stderr = String::from_utf8(output.stderr).unwrap();
    println!("{stdout}{stderr}");
    assert!(stdout.lines().any(|line| line == "R3_TIMEOUT_PERSISTED"));
    assert_eq!(output.status.code(), Some(1));
}
