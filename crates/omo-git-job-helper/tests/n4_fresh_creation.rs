//! N4 (design v4.2 section 20): a name that already exists is refused in-frame; `run` spawns nothing.
#![cfg(windows)]

mod support;

use std::process::{Command, Stdio};
use std::time::Duration;

use support::pipe::ServerPipe;
use support::{helper_exe, job, job_name, unique, Receipt, EXIT_JOB_EXISTS};
use windows_sys::Win32::Foundation::ERROR_ALREADY_EXISTS;

#[test]
fn n4_an_existing_job_name_is_refused_and_nothing_runs() {
    let mut receipt = Receipt::new("N4");
    let id = unique("n4");
    let name = job_name(&id);
    let (first, first_error) = job::create(&name, None);
    let first = first.expect("first CreateJobObjectW");
    let (second, second_error) = job::create(&name, None);
    receipt.line(format!(
        "first error {first_error}; second handle={} error {second_error}",
        second.is_some()
    ));
    assert_eq!(second_error, ERROR_ALREADY_EXISTS, "{receipt}");
    drop(second);
    let mut pipe =
        ServerPipe::create(&format!("omo-git-op-{id}"), None, true).expect("control pipe");
    let mut helper = Command::new(helper_exe())
        .args(["run", "--op", &id])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()
        .expect("spawn");
    use std::os::windows::io::AsRawHandle;
    let connected = pipe.accept(Duration::from_secs(10), Some(helper.as_raw_handle()));
    let frame = connected.and_then(|()| pipe.read_line(Duration::from_secs(10)));
    let status = helper.wait().expect("helper exit");
    let active = job::accounting(first.raw()).map(|info| info.ActiveProcesses);
    receipt.line(format!(
        "frame {frame:?}; exit {:?}; F active processes {active:?}",
        status.code()
    ));
    assert!(
        frame
            .as_deref()
            .is_ok_and(|line| line.starts_with("error job-exists")),
        "{receipt}"
    );
    assert_eq!(active, Some(0), "{receipt}");
    assert_eq!(
        status.code().and_then(|code| u32::try_from(code).ok()),
        Some(EXIT_JOB_EXISTS),
        "{receipt}"
    );
}
