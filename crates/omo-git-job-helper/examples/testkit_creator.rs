//! Testkit image for N1: joins <job> (no limits), spawns <blocker> <suffix> as a member, prints `spawned <pid>`,
//! then on a `close` line from stdin either closes its only job handle (mode `close`) or exits (mode `die`).
#[cfg(windows)]
#[path = "../testkit/win.rs"]
mod win;

#[cfg(windows)]
fn main() {
    use std::io::{BufRead, Write};
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    let args: Vec<String> = std::env::args().collect();
    let [_, job_name, blocker, suffix, mode] = args.as_slice() else {
        std::process::exit(2)
    };
    let name = win::wide(job_name);
    // SAFETY: `name` is NUL-terminated; default security, non-inheritable handle.
    let Some(job) = win::Owned::new(unsafe { CreateJobObjectW(std::ptr::null(), name.as_ptr()) })
    else {
        std::process::exit(3)
    };
    // SAFETY: both handles are valid; the pseudo-handle names this process.
    if unsafe { AssignProcessToJobObject(job.raw(), GetCurrentProcess()) } == 0 {
        std::process::exit(4);
    }
    let Ok((member, pid)) = win::spawn(std::path::Path::new(blocker), &[suffix], 0) else {
        std::process::exit(5)
    };
    drop(member);
    let mut out = std::io::stdout();
    let mut line = String::new();
    let mut input = std::io::stdin().lock();
    if writeln!(out, "spawned {pid}")
        .and_then(|()| out.flush())
        .is_err()
        || input.read_line(&mut line).is_err()
    {
        std::process::exit(6);
    }
    if mode == "die" {
        std::process::exit(0);
    }
    drop(job);
    if writeln!(out, "closed").and_then(|()| out.flush()).is_err() {
        std::process::exit(6);
    }
    while input.read_line(&mut line).is_ok_and(|read| read > 0) {}
}

#[cfg(not(windows))]
fn main() {}
