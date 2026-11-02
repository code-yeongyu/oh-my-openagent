//! `selftest` mode (design v4.2 section 6.3): the run-mode create / limits / read back / join / verify sequence on
//! a fresh name, plus the token facts for the receipt. Success lets the writer claim `win32-job-v1` (section 13).
use std::io::Write;

use windows_sys::Win32::System::Performance::QueryPerformanceCounter;
use windows_sys::Win32::System::Threading::GetCurrentProcessId;

use crate::cli::Exit;
use crate::job;
use crate::security;

fn emit(line: &str) {
    let mut out = std::io::stdout().lock();
    // A selftest whose caller stopped reading still reports through its exit code.
    if writeln!(out, "{line}").and_then(|()| out.flush()).is_err() {
        std::process::exit(Exit::Pipe.code());
    }
}

pub fn selftest() -> Exit {
    let mut counter = 0i64;
    // SAFETY: plain queries about this process and the performance counter.
    let (pid, _) = unsafe { (GetCurrentProcessId(), QueryPerformanceCounter(&mut counter)) };
    let name = format!(r"Global\omo-memory-git-selftest-{pid}-{counter}");
    let attributes = match security::job_attributes() {
        Ok(attributes) => attributes,
        Err(error) => {
            emit(&format!("selftest failed sd-failed {error}"));
            return Exit::SecurityDescriptor;
        }
    };
    let joined =
        job::create(&name, &attributes).and_then(|floor| floor.join_self().map(|()| floor));
    let _floor = match joined {
        Ok(floor) => floor,
        Err(error) => {
            let (detail, exit) = error.describe();
            emit(&format!("selftest failed {detail}"));
            return exit;
        }
    };
    match security::token_facts() {
        Ok((elevated, integrity)) => emit(&format!(
            "selftest ok elevated={} integrity={integrity:#x}",
            u8::from(elevated)
        )),
        Err(error) => emit(&format!(
            "selftest ok elevated=unknown integrity=unknown:{error}"
        )),
    }
    Exit::Ok
}
