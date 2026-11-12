//! The poison record of a crashed callId fails CLOSED: a record that cannot be read, or an
//! `uncertain/` directory that is not a real directory, reads as poisoned.

use std::fs;
use std::path::Path;

use omo_computer_core::report::Disposition;

use super::recovery::die_after_input;
use super::{click, wire, Run};

/// Crash `c-tamper`, re-drive it once (the marker clears, the poison record is written),
/// tamper with the record's directory, then re-drive again on a fresh engine.
fn redrive_after(tamper: impl FnOnce(&Path), restore: impl FnOnce(&Path)) {
    let run = Run::new();
    die_after_input(&run, "c-tamper", 1);
    let mut first = run.session(Box::new(run.fake()));
    first
        .click(click("c-tamper"))
        .expect_err("the first re-drive is refused");
    drop(first);
    let uncertain = run.dir.path().join("markers/local/default.uncertain");
    assert!(
        uncertain.join("c-tamper").exists(),
        "the poison record was written"
    );
    tamper(&uncertain);
    let mut restarted = run.session(Box::new(run.fake()));
    let redrive = restarted.click(click("c-tamper"));
    restore(&uncertain);
    let redrive = redrive.expect_err("a tampered poison record still refuses the crashed callId");
    assert_eq!(
        wire(&redrive),
        ("TransactionFailed", Some("recovery_required"))
    );
    assert_eq!(redrive.interrupted, Some(Disposition::UNCERTAIN_UNSAFE));
    assert_eq!(
        run.sink.len(),
        3,
        "delivered exactly once: {:?}",
        run.sink.lines()
    );
}

#[cfg(unix)]
#[test]
fn unreadable_uncertain_dir_reads_as_poisoned() {
    use std::os::unix::fs::PermissionsExt;
    redrive_after(
        |dir| fs::set_permissions(dir, fs::Permissions::from_mode(0o000)).expect("chmod 000"),
        |dir| fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).expect("restore"),
    );
}

#[test]
fn uncertain_dir_replaced_by_a_file_reads_as_poisoned() {
    redrive_after(
        |dir| {
            fs::remove_dir_all(dir).expect("remove");
            fs::write(dir, b"not a directory").expect("a file in its place");
        },
        |_| {},
    );
}

#[cfg(unix)]
#[test]
fn symlinked_uncertain_dir_reads_as_poisoned() {
    redrive_after(
        |dir| {
            let elsewhere = dir.with_file_name("elsewhere");
            fs::create_dir(&elsewhere).expect("an empty dir");
            fs::remove_dir_all(dir).expect("remove");
            std::os::unix::fs::symlink(&elsewhere, dir).expect("symlink");
        },
        |_| {},
    );
}
