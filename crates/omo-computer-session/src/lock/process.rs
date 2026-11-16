//! A-IS-65 tests T2, T3, T4, T10 and T11's reparse leg: the interaction lock across processes.
//! A holder is this test binary re-invoked as a child (`crate::test_process`).

use std::fs;

use super::{InteractionLock, LOCK_FILE};
use crate::test_process::{command, playing, until_released, within, Player};

const HELD: &str = "HELD";
const SLEEPING: &str = "SLEEPING";

#[test]
fn role_holder() {
    if let Some(dir) = playing("holder") {
        let held = InteractionLock::under(&dir)
            .acquire()
            .expect("the holder takes the lock");
        println!("{HELD}");
        until_released();
        drop(held);
    }
}

#[test]
fn role_spawner() {
    if let Some(dir) = playing("spawner") {
        let held = InteractionLock::under(&dir)
            .acquire()
            .expect("the spawner takes the lock");
        let path = concat!(module_path!(), "::role_sleeper");
        let _sleeper = command(path, "sleeper", &dir)
            .spawn()
            .expect("spawn the sleeper");
        println!("{HELD}");
        std::mem::forget(held);
        std::process::exit(0);
    }
}

#[test]
fn role_sleeper() {
    if playing("sleeper").is_some() {
        println!("{SLEEPING}");
        until_released();
    }
}

fn holder(role: &str, dir: &std::path::Path) -> Player {
    let path = match role {
        "spawner" => concat!(module_path!(), "::role_spawner"),
        _ => concat!(module_path!(), "::role_holder"),
    };
    Player::spawn(path, role, dir)
}

fn acquired_within_bound(dir: &std::path::Path) -> bool {
    let lock = InteractionLock::under(dir);
    within("acquire", move || lock.acquire().is_ok())
}

#[test]
fn a_lock_held_by_another_process_is_held_here_until_that_process_releases_it() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut holder = holder("holder", dir.path());
    holder.wait_for(&[HELD]);
    let probe = InteractionLock::under(dir.path()).try_acquire();
    assert!(
        matches!(probe, Ok(None)),
        "held by the other process: {probe:?}"
    );
    holder.release();
    assert!(
        acquired_within_bound(dir.path()),
        "free once the holder released it"
    );
    assert!(holder.exited().success());
}

#[test]
fn a_killed_holder_frees_the_lock_for_the_next_acquire() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut holder = holder("holder", dir.path());
    holder.wait_for(&[HELD]);
    holder.kill();
    holder.exited();
    assert!(
        acquired_within_bound(dir.path()),
        "the OS freed a dead holder's lock"
    );
}

#[test]
fn try_acquire_on_a_held_lock_is_held_not_an_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let held = InteractionLock::under(dir.path())
        .acquire()
        .expect("first holder");
    let probe = InteractionLock::under(dir.path()).try_acquire();
    assert!(matches!(probe, Ok(None)), "{probe:?}");
    drop(held);
}

#[test]
fn a_child_spawned_by_the_holder_does_not_keep_the_lock_after_the_holder_exits() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut spawner = holder("spawner", dir.path());
    spawner.wait_for(&[HELD, SLEEPING]);
    assert!(spawner.exited().success());
    assert!(
        acquired_within_bound(dir.path()),
        "the sleeping child of the holder does not hold the lock"
    );
}

#[test]
fn a_link_at_the_lock_file_refuses_and_is_never_held() {
    let dir = tempfile::tempdir().expect("tempdir");
    let elsewhere = dir.path().join("elsewhere");
    fs::write(&elsewhere, b"").expect("target file");
    let link = dir.path().join(LOCK_FILE);
    #[cfg(unix)]
    std::os::unix::fs::symlink(&elsewhere, &link).expect("symlink");
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(&elsewhere, &link)
        .expect("symlink (the runner has the privilege)");
    let lock = InteractionLock::under(dir.path());
    assert!(lock.acquire().is_err(), "acquire refuses a link");
    assert!(
        lock.try_acquire().is_err(),
        "try_acquire refuses a link, never 'held'"
    );
}

#[cfg(windows)]
#[test]
fn a_held_lock_file_cannot_be_deleted_or_renamed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let lock = InteractionLock::under(dir.path());
    let held = lock.acquire().expect("held");
    assert!(
        fs::remove_file(lock.path()).is_err(),
        "no delete while held (L12)"
    );
    assert!(
        fs::rename(lock.path(), dir.path().join("moved")).is_err(),
        "no rename while held (L12)"
    );
    drop(held);
}
