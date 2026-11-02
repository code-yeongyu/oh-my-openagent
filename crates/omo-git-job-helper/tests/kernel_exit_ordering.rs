//! Kernel exit ordering (omo#10391, design v4.2 R2 and R6): on a job this test owns, with the root image H spawns in
//! the done-latency row (a console process, so its conhost joins too), each job message is stamped at dequeue
//! together with the job's `ActiveProcesses` and the member's handle state, read before anything else runs. This is
//! the ordering H's `done` decision depends on.
#![cfg(windows)]

mod support;

use std::collections::HashMap;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use support::observer::Observer;
use support::timeline::{member_label, Timeline};
use support::win::{command_line, last_error, wide, Owned};
use support::{example, job, process, unique, Receipt};
use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectAssociateCompletionPortInformation,
    JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECTINFOCLASS,
    JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::SystemServices::{
    JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS, JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO,
    JOB_OBJECT_MSG_EXIT_PROCESS, JOB_OBJECT_MSG_NEW_PROCESS,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, ResumeThread, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
    PROCESS_INFORMATION, STARTUPINFOW,
};
use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};

const ITERATIONS: usize = 20;
const BOUND: Duration = Duration::from_secs(30);
const KEY: usize = 7;

struct KernelJob {
    job: Owned,
    port: Owned,
}

fn set<T>(job: HANDLE, class: JOBOBJECTINFOCLASS, value: &T) {
    let size = u32::try_from(std::mem::size_of::<T>()).unwrap_or(0);
    // SAFETY: `value` is the C struct this information class expects and is readable for `size` bytes.
    let ok = unsafe { SetInformationJobObject(job, class, std::ptr::from_ref(value).cast(), size) };
    assert!(ok != 0, "SetInformationJobObject {class} {}", last_error());
}

/// Kill-on-close only so a failed row leaves nothing behind; the port receives every job message.
fn kernel_job() -> KernelJob {
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
fn spawn_into(job: HANDLE, exe: &Path, args: &[&str]) -> (Owned, u32) {
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

fn message_name(message: u32) -> String {
    match message {
        JOB_OBJECT_MSG_NEW_PROCESS => "NEW_PROCESS".into(),
        JOB_OBJECT_MSG_EXIT_PROCESS => "EXIT_PROCESS".into(),
        JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS => "ABNORMAL_EXIT_PROCESS".into(),
        JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => "ACTIVE_PROCESS_ZERO".into(),
        other => format!("msg-{other}"),
    }
}

struct Dequeued {
    message: u32,
    active: Option<u32>,
    signaled: Option<bool>,
}

type Members = Arc<Mutex<HashMap<u32, Owned>>>;

fn is_exit(message: u32) -> bool {
    matches!(
        message,
        JOB_OBJECT_MSG_EXIT_PROCESS | JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS
    )
}

/// Dequeues until ACTIVE_PROCESS_ZERO or a 30 s silence, reading the count and the member's handle state first.
fn drain(job: &Owned, port: &Owned, members: &Members, timeline: &Timeline) -> Vec<Dequeued> {
    let mut dequeued = Vec::new();
    loop {
        let (mut message, mut key, mut overlapped) = (0u32, 0usize, null_mut());
        // SAFETY: all three out-parameters are writable locals.
        let ok = unsafe {
            GetQueuedCompletionStatus(port.raw(), &mut message, &mut key, &mut overlapped, 30_000)
        } != 0;
        if !ok {
            timeline.mark(format!("port wait ended {}", last_error()));
            return dequeued;
        }
        let active = job::accounting(job.raw()).map(|info| info.ActiveProcesses);
        let pid = u32::try_from(overlapped.addr()).unwrap_or(0);
        let signaled = members.lock().expect("members").get(&pid).map(|handle| {
            // SAFETY: a zero-timeout wait on a live process handle.
            unsafe { WaitForSingleObject(handle.raw(), 0) == WAIT_OBJECT_0 }
        });
        timeline.mark(format!(
            "msg {} pid {pid} active {active:?} signaled {signaled:?}",
            message_name(message)
        ));
        dequeued.push(Dequeued {
            message,
            active,
            signaled,
        });
        if message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO {
            return dequeued;
        }
    }
}

#[derive(Default)]
struct Tally {
    exits: usize,
    stale: usize,
    unsignaled: usize,
}

#[test]
fn kernel_member_exit_messages_against_the_active_count() {
    let mut receipt = Receipt::new("kernel exit ordering");
    let mut tally = Tally::default();
    for index in 0..ITERATIONS {
        let kernel = Arc::new(kernel_job());
        let suffix = unique("kernel-exit");
        let observer = Observer::start(&suffix, None);
        let timeline = Timeline::new();
        let members: Members = Arc::new(Mutex::new(HashMap::new()));
        let drainer = {
            let (kernel, members, timeline) = (
                Arc::clone(&kernel),
                Arc::clone(&members),
                Arc::clone(&timeline),
            );
            std::thread::spawn(move || drain(&kernel.job, &kernel.port, &members, &timeline))
        };
        let (_root, root_pid) =
            spawn_into(kernel.job.raw(), &example("testkit_blocker"), &[&suffix]);
        assert!(
            observer.wait_for(1, BOUND),
            "iteration {index}: root never connected"
        );
        let (mut waiters, mut labels) = (Vec::new(), Vec::new());
        for pid in job::pid_list(kernel.job.raw()) {
            let (Some(watched), Some(probe)) = (
                process::open(pid, process::WATCH),
                process::open(pid, process::WATCH),
            ) else {
                labels.push(format!("{pid}:unopenable"));
                continue;
            };
            let label = member_label(watched.raw(), pid);
            labels.push(label.clone());
            members.lock().expect("members").insert(pid, probe);
            waiters.push(timeline.watch_exit(watched, label, BOUND));
        }
        let release = timeline.mark("release");
        observer.stop();
        let dequeued = drainer.join().expect("drainer");
        for waiter in waiters {
            waiter.join().expect("waiter");
        }
        let member_count = members.lock().expect("members").len();
        let mut seen = 0usize;
        for entry in dequeued.iter().filter(|entry| is_exit(entry.message)) {
            seen += 1;
            let expected = u32::try_from(member_count.saturating_sub(seen)).unwrap_or(0);
            tally.stale += usize::from(entry.active.is_some_and(|active| active > expected));
            tally.unsignaled += usize::from(entry.signaled == Some(false));
        }
        tally.exits += seen;
        receipt.line(format!(
            "iter {index}: root {root_pid}; members {labels:?}; timeline: {}",
            timeline.render(release)
        ));
        assert!(
            dequeued
                .last()
                .is_some_and(|entry| entry.message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO),
            "iteration {index}: no ACTIVE_PROCESS_ZERO\n{receipt}"
        );
        assert_eq!(
            seen, member_count,
            "iteration {index}: one exit message per member\n{receipt}"
        );
    }
    receipt.line(format!(
        "summary: {ITERATIONS} iterations; {} member-exit messages; dequeued while ActiveProcesses still counted the \
         member {}; dequeued before the member's handle signaled {}",
        tally.exits, tally.stale, tally.unsignaled
    ));
}
