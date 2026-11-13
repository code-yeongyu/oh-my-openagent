//! The control pipe's client side (review of #12105): the helper connects for identification only (finding 6), and
//! a writer that stops reading cannot hold off the linger kill (finding 3).
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::Duration;

use support::observer::Observer;
use support::op::{Launcher, Op};
use support::{example, process, scratch, unique, Receipt, LINGER_KILL_CODE};
use windows_sys::Win32::Security::SecurityIdentification;

#[test]
fn the_helper_lets_the_pipe_server_identify_it_but_never_impersonate_it() {
    let op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let level = op.pipe.client_impersonation_level();
    assert_eq!(
        level,
        Ok(SecurityIdentification),
        "client impersonation level {level:?}"
    );
}

#[test]
fn a_writer_that_stops_reading_cannot_hold_off_the_linger_kill() {
    let mut receipt = Receipt::new("stalled writer");
    let suffix = unique("stall");
    let observer = Observer::start(&suffix, None);
    // Inbound quota 0: every helper report pends until this side reads it.
    let mut op =
        Op::start_with_inbound_quota(&["--linger-ms", "2000"], Launcher::Direct, Stdio::null(), 0)
            .expect("helper run");
    let blocker = example("testkit_blocker");
    let spawned = op
        .go(
            &scratch("stall"),
            &example("testkit_detach"),
            &[&blocker.to_string_lossy(), &suffix],
        )
        .expect("go");
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "the descendant never connected"
    );
    let member = observer
        .with(|accepted| accepted[0].process.as_ref().map(|owned| owned.raw()))
        .expect("member handle");
    // From here the writer reads nothing more: the root's `exit` report never completes on its own.
    let member_dead = process::signaled_within(member, Duration::from_secs(30));
    let code = op.exited_within(Duration::from_secs(10));
    receipt.line(format!(
        "{spawned}; descendant killed within 30 s {member_dead}; helper exit {code:?}"
    ));
    assert!(member_dead, "{receipt}");
    assert_eq!(code, Some(LINGER_KILL_CODE), "{receipt}");
}
