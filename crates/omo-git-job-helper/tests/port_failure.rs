//! Review of #12105, finding 5: a failed completion port ends the helper with exit 22 (PortFailed), in AWAIT_GO and
//! while running, where it also takes the operation down with it. The port is closed from outside with
//! DUPLICATE_CLOSE_SOURCE; its handle value is the first argument of the helper's first GetQueuedCompletionStatus.
#![cfg(windows)]

mod support;

use std::time::Duration;

use support::observer::Observer;
use support::op::Op;
use support::win::last_error;
use support::{example, process, scratch, unique, Receipt, EXIT_PORT_FAILED};
use windows_sys::Win32::Foundation::{DuplicateHandle, DUPLICATE_CLOSE_SOURCE, HANDLE};

fn debugged_to_its_port() -> (Op, u64) {
    let mut port = 0u64;
    let (op, joined) =
        Op::start_debugged("GetQueuedCompletionStatus", |hit| port = hit.first_argument)
            .expect("debugged helper run");
    assert!(
        joined.starts_with("joined "),
        "expected joined, got {joined:?}"
    );
    (op, port)
}

fn close_in_helper(helper: HANDLE, value: u64) {
    let source = std::ptr::without_provenance_mut(usize::try_from(value).expect("handle value"));
    // SAFETY: closes one handle in the helper's table; no handle is created in this process.
    let ok = unsafe {
        DuplicateHandle(
            helper,
            source,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            0,
            DUPLICATE_CLOSE_SOURCE,
        )
    };
    assert!(ok != 0, "closing the helper's port failed {}", last_error());
}

#[test]
fn a_failed_port_in_await_go_exits_22_without_running_anything() {
    let mut receipt = Receipt::new("port-failed await-go");
    let (op, port) = debugged_to_its_port();
    close_in_helper(op.helper.raw(), port);
    let code = op.exited_within(Duration::from_secs(30));
    receipt.line(format!("port {port:#x}; exit {code:?}"));
    assert_eq!(code, Some(EXIT_PORT_FAILED), "{receipt}");
}

#[test]
fn a_failed_port_while_running_kills_the_operation_and_exits_22() {
    let mut receipt = Receipt::new("port-failed running");
    let (mut op, port) = debugged_to_its_port();
    let suffix = unique("port");
    let observer = Observer::start(&suffix, None);
    let spawned = op
        .go(&scratch("port"), &example("testkit_blocker"), &[&suffix])
        .expect("go");
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "the root never connected"
    );
    let root = observer
        .with(|accepted| accepted[0].process.as_ref().map(|owned| owned.raw()))
        .expect("root handle");
    close_in_helper(op.helper.raw(), port);
    let code = op.exited_within(Duration::from_secs(30));
    let root_dead = process::signaled_within(root, Duration::from_secs(10));
    receipt.line(format!(
        "{spawned}; port {port:#x}; exit {code:?}; root killed {root_dead}"
    ));
    assert_eq!(code, Some(EXIT_PORT_FAILED), "{receipt}");
    assert!(root_dead, "{receipt}");
}
