//! A job a contract row owns (not F): kill-on-close and a completion port, and a console child created into it the way
//! H spawns git, so the conhost its console start creates is a member too.
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation,
    JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECTINFOCLASS,
    JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, ResumeThread, CREATE_NO_WINDOW, CREATE_SUSPENDED, PROCESS_INFORMATION,
    STARTUPINFOW,
};
use windows_sys::Win32::System::IO::CreateIoCompletionPort;

use super::win::{command_line, last_error, wide, Owned};

pub const KEY: usize = 7;

pub struct KernelJob {
    pub job: Owned,
    pub port: Owned,
}

fn set<T>(job: HANDLE, class: JOBOBJECTINFOCLASS, value: &T) {
    let size = u32::try_from(std::mem::size_of::<T>()).unwrap_or(0);
    // SAFETY: `value` is the C struct this information class expects and is readable for `size` bytes.
    let ok = unsafe { SetInformationJobObject(job, class, std::ptr::from_ref(value).cast(), size) };
    assert!(ok != 0, "SetInformationJobObject {class} {}", last_error());
}

/// Kill-on-close only so a failed row leaves nothing behind; the port receives every job message.
pub fn kernel_job() -> KernelJob {
    // SAFETY: an unnamed job with default security.
    let job = Owned::new(unsafe { CreateJobObjectW(null(), null()) }).expect("CreateJobObjectW");
    // SAFETY: a plain C struct for which all-zero is valid.
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    set(job.raw(), JobObjectExtendedLimitInformation, &limits);
    // SAFETY: a new port with one concurrent thread; no file handle is associated.
    let port =
        Owned::new(unsafe { CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1) })
            .expect("CreateIoCompletionPort");
    let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
        CompletionKey: std::ptr::without_provenance_mut(KEY),
        CompletionPort: port.raw(),
    };
    set(
        job.raw(),
        JobObjectAssociateCompletionPortInformation,
        &association,
    );
    KernelJob { job, port }
}

/// Creates `exe args` suspended with `CREATE_NO_WINDOW` (as H spawns git), assigns it, then resumes it, so the
/// conhost its console start creates joins the job too.
pub fn spawn_into(job: HANDLE, exe: &Path, args: &[&str]) -> (Owned, u32) {
    let exe_text = exe.to_string_lossy();
    let mut line_args = vec![exe_text.as_ref()];
    line_args.extend_from_slice(args);
    let application = wide(&exe_text);
    let mut line = wide(&command_line(&line_args));
    // SAFETY: plain C structs for which all-zero is valid.
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = u32::try_from(std::mem::size_of::<STARTUPINFOW>()).unwrap_or(0);
    // SAFETY: as above.
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: both strings are NUL-terminated and outlive the call; `line` is writable as the API requires.
    let ok = unsafe {
        CreateProcessW(
            application.as_ptr(),
            line.as_mut_ptr(),
            null(),
            null(),
            0,
            CREATE_SUSPENDED | CREATE_NO_WINDOW,
            null(),
            null(),
            &startup,
            &mut info,
        )
    };
    assert!(ok != 0, "CreateProcessW {}", last_error());
    let process = Owned::new(info.hProcess).expect("process handle");
    let thread = Owned::new(info.hThread).expect("thread handle");
    // SAFETY: both handles are live; the child has not run an instruction yet.
    let assigned = unsafe { AssignProcessToJobObject(job, process.raw()) };
    assert!(assigned != 0, "AssignProcessToJobObject {}", last_error());
    // SAFETY: the primary thread handle is live and was suspended once at creation.
    let resumed = unsafe { ResumeThread(thread.raw()) };
    assert!(resumed != u32::MAX, "ResumeThread {}", last_error());
    (process, info.dwProcessId)
}
