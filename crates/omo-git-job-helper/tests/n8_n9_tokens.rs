//! N8 and N9 (design v4.2 sections 14 and 20; R4, R5): across integrity levels the probe reads the truth or fails
//! closed as unknown, never a false reclaimable; a Medium-integrity token can create a `Global\\` job.
#![cfg(windows)]

mod support;

use std::process::{Command, Stdio};
use std::time::Duration;

use support::lines::run_bounded;
use support::observer::Observer;
use support::op::{Launcher, Op};
use support::win::{creation_time, spawn};
use support::{example, helper_exe, process, scratch, sddl, token, unique, Receipt, EXIT_OK};

const MEDIUM: u32 = 0x2000;

fn probe(standard: bool, input: &str) -> (Option<i32>, String, String) {
    let mut command = if standard {
        Command::new(example("testkit_run_as_standard"))
    } else {
        Command::new(helper_exe())
    };
    if standard {
        command.arg("--").arg(helper_exe());
    }
    command.arg("probe");
    run_bounded(command, input.as_bytes(), Duration::from_secs(30))
}

fn cross_level(helper_launcher: Launcher, standard_probe: bool) {
    let mut receipt = Receipt::new(format!("N8 (standard probe: {standard_probe})"));
    let suffix = unique("n8");
    let medium = sddl::medium_user_sddl();
    let observer = Observer::start(&suffix, (!standard_probe).then_some(medium.as_str()));
    let mut op = Op::start(&[], helper_launcher, Stdio::null()).expect("helper run");
    op.go(&scratch("n8"), &example("testkit_blocker"), &[&suffix])
        .expect("go");
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "member never connected"
    );
    let helper_ft = creation_time(op.helper.raw()).expect("helper creation time");
    let (dead, dead_pid) = spawn(
        &example("testkit_touch"),
        &[&scratch("n8").join("t").to_string_lossy()],
        0,
    )
    .expect("touch");
    assert!(
        process::signaled_within(dead.raw(), Duration::from_secs(30)),
        "touch did not exit"
    );
    let dead_ft = creation_time(dead.raw()).expect("dead creation time");
    let helper_facts = token::process_facts(op.helper_pid).expect("helper token facts");
    let input = format!(
        "entry {} {helper_ft} {}\nentry {dead_pid} {dead_ft} {}\n",
        op.helper_pid, op.id, op.id
    );
    let (code, stdout, stderr) = probe(standard_probe, &input);
    receipt.line(format!(
        "helper elevated={} integrity={:#x}; probe stderr {stderr:?}; exit {code:?}",
        helper_facts.elevated, helper_facts.integrity
    ));
    for line in stdout.lines() {
        receipt.line(line.to_owned());
    }
    let lines: Vec<&str> = stdout.lines().collect();
    let first = lines.first().copied().unwrap_or_default();
    let second = lines.get(1).copied().unwrap_or_default();
    assert!(
        first.contains("helper=alive") || first.contains("helper=unknown"),
        "{receipt}"
    );
    assert!(
        (second.contains("job=active:") && !second.contains("job=active:0"))
            || second.contains("job=unknown"),
        "{receipt}"
    );
    assert!(
        lines
            .iter()
            .take(2)
            .all(|line| !line.contains("verdict=reclaimable")),
        "{receipt}"
    );
    let probe_integrity = if standard_probe {
        MEDIUM
    } else {
        token::process_facts(std::process::id())
            .expect("own facts")
            .integrity
    };
    assert_ne!(
        helper_facts.integrity, probe_integrity,
        "the two participants ran at the same integrity level\n{receipt}"
    );
    observer.stop();
    assert!(
        op.frames_until("done", Duration::from_secs(30)).is_ok(),
        "{receipt}"
    );
    assert_eq!(
        op.exited_within(Duration::from_secs(10)),
        Some(EXIT_OK),
        "{receipt}"
    );
}

#[test]
fn n8_runner_token_helper_read_by_a_standard_probe() {
    cross_level(Launcher::Direct, true);
}

#[test]
fn n8_standard_helper_read_by_a_runner_token_probe() {
    cross_level(Launcher::Standard, false);
}

#[test]
fn n9_selftest_creates_a_global_job_under_a_standard_token() {
    let mut receipt = Receipt::new("N9");
    let mut command = Command::new(example("testkit_run_as_standard"));
    command.arg("--").arg(helper_exe()).arg("selftest");
    let (code, stdout, stderr) = run_bounded(command, b"", Duration::from_secs(30));
    receipt.line(format!(
        "exit {code:?}; stdout {stdout:?}; stderr {stderr:?}"
    ));
    assert!(stdout.starts_with("selftest ok "), "{receipt}");
    assert!(
        stdout.contains(&format!("integrity={MEDIUM:#x}")),
        "{receipt}"
    );
    assert_eq!(code, Some(0), "{receipt}");
}
