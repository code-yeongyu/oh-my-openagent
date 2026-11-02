//! Review of #12105, finding 1: a verification that fails after the helper already joined F (design 6.1 Join,
//! Verify) must still report `error verify-failed` and exit 19 holding F; kill-on-close must never end the helper
//! with code 0 first. A member the test adds to F while the helper is stopped on AssignProcessToJobObject makes the
//! post-join ActiveProcesses check read 2.
#![cfg(windows)]

mod support;

use std::time::Duration;

use support::observer::Observer;
use support::op::Op;
use support::sddl::from_sddl;
use support::win::{last_error, spawn, wide, Owned};
use support::{example, job, job_name, process, sddl, unique, Receipt, EXIT_VERIFY};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Security::{SetKernelObjectSecurity, DACL_SECURITY_INFORMATION};
use windows_sys::Win32::Storage::FileSystem::{READ_CONTROL, WRITE_DAC};
use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, OpenJobObjectW};
use windows_sys::Win32::System::SystemServices::{JOB_OBJECT_ASSIGN_PROCESS, JOB_OBJECT_QUERY};

fn open(name: &str, access: u32) -> Result<Owned, String> {
    let name = wide(name);
    // SAFETY: `name` is NUL-terminated.
    Owned::new(unsafe { OpenJobObjectW(access, 0, name.as_ptr()) })
        .ok_or_else(|| format!("OpenJobObjectW({access:#x}) failed {}", last_error()))
}

/// Adds `member` to F before the helper joins it, and returns F's active count afterwards. The test runs as the
/// account that owns F, and owner rights let it widen F's DACL first. Every test handle to F is closed on return,
/// so the helper's handle is again F's only one.
fn inject(name: &str, member: HANDLE) -> Result<u32, String> {
    let owner = open(name, WRITE_DAC | READ_CONTROL)?;
    let widened = from_sddl(&format!(
        "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;{})",
        sddl::current_user_sid()
    ))
    .map_err(|error| format!("sddl {error}"))?;
    // SAFETY: `owner` carries WRITE_DAC and the descriptor outlives the call.
    if unsafe {
        SetKernelObjectSecurity(
            owner.raw(),
            DACL_SECURITY_INFORMATION,
            widened.attributes.lpSecurityDescriptor,
        )
    } == 0
    {
        return Err(format!("SetKernelObjectSecurity failed {}", last_error()));
    }
    drop(owner);
    let assign = open(name, JOB_OBJECT_ASSIGN_PROCESS | JOB_OBJECT_QUERY)?;
    // SAFETY: both handles are live.
    if unsafe { AssignProcessToJobObject(assign.raw(), member) } == 0 {
        return Err(format!("AssignProcessToJobObject failed {}", last_error()));
    }
    job::accounting(assign.raw())
        .map(|info| info.ActiveProcesses)
        .ok_or_else(|| "accounting failed".to_owned())
}

#[test]
fn a_failed_join_verification_reports_and_exits_19_holding_f() {
    let mut receipt = Receipt::new("verify-failed");
    let suffix = unique("verify-member");
    let observer = Observer::start(&suffix, None);
    let (member, _) = spawn(&example("testkit_blocker"), &[&suffix], 0).expect("spawn member");
    assert!(
        observer.wait_for(1, Duration::from_secs(30)),
        "the member never connected"
    );
    let mut injected = None;
    let started = Op::start_debugged("AssignProcessToJobObject", |hit| {
        injected = Some(inject(&job_name(hit.op_id), member.raw()));
    });
    receipt.line(format!("injected {injected:?}"));
    let (op, first) = started.unwrap_or_else(|error| {
        process::terminate(member.raw());
        panic!("no report from the helper: {error}\n{receipt}")
    });
    let code = op.exited_within(Duration::from_secs(30));
    let member_dead = process::signaled_within(member.raw(), Duration::from_secs(10));
    let gone = job::wait_gone(&op.job(), Duration::from_secs(10)).is_some();
    receipt.line(format!(
        "first frame {first:?}; exit {code:?}; member killed {member_dead}; name gone {gone}"
    ));
    assert_eq!(injected, Some(Ok(1)), "{receipt}");
    assert_eq!(first, "error verify-failed 0", "{receipt}");
    assert_eq!(code, Some(EXIT_VERIFY), "{receipt}");
    assert!(member_dead && gone, "{receipt}");
}
