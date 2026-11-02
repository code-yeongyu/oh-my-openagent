//! `run` mode, the operation helper H (design v4.2 sections 6.1, 7.2, 9, 10.2): F is created, limited, joined and
//! verified before anything is spawned; `AWAIT_GO` has no timer; root exit is reported `empty` or `lingering`.
use std::ptr::null_mut;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::SystemServices::JOB_OBJECT_MSG_NEW_PROCESS;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetExitCodeProcess, TerminateProcess,
    WaitForSingleObject, INFINITE,
};
use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};

use crate::cli::{Exit, OpId, LINGER_KILL_CODE};
use crate::control::{self, Control};
use crate::frames::{ExecRequest, Frame, FrameReader};
use crate::job::{self, JobError, JoinedJob};
use crate::members::{MemberWaits, MEMBER_KEY};
use crate::security;
use crate::spawn::{self, Root};
use crate::win::{creation_time, last_error, Owned};

const JOB_KEY: usize = 1;
const PIPE_KEY: usize = 2;
/// Job notifications are documented as not guaranteed, so a running operation re-checks its state this often. It is
/// only the safety net: member exits wake the loop through `MemberWaits`.
const RECHECK_MS: u32 = 250;

enum Event {
    Pipe {
        ok: bool,
        transferred: u32,
    },
    /// A job message: its id and the process id it names.
    Job {
        message: u32,
        pid: usize,
    },
    MemberExited,
    Other,
    PortFailed,
}

fn next_event(port: HANDLE, control: &Control, timeout: u32) -> Event {
    let (mut transferred, mut key, mut overlapped) = (0u32, 0usize, null_mut());
    // SAFETY: all three out-parameters are writable locals.
    let ok = unsafe {
        GetQueuedCompletionStatus(port, &mut transferred, &mut key, &mut overlapped, timeout)
    } != 0;
    if !ok && overlapped.is_null() {
        return if last_error() == WAIT_TIMEOUT {
            Event::Other
        } else {
            Event::PortFailed
        };
    }
    if key == PIPE_KEY && control.is_read(overlapped) {
        Event::Pipe { ok, transferred }
    } else if key == MEMBER_KEY {
        Event::MemberExited
    } else if key == JOB_KEY {
        Event::Job {
            message: transferred,
            pid: overlapped.addr(),
        }
    } else {
        Event::Other
    }
}

enum Ended {
    Go(ExecRequest),
    Cancel,
    Eof,
    PortFailed,
}

/// `AWAIT_GO` (section 7.2): no timer. Ends on `go` after one `exec`, on `cancel`, on any malformed frame, or on EOF.
fn await_go(control: &mut Control, port: HANDLE, reader: &mut FrameReader) -> Ended {
    let mut request = None;
    if !control.start_read() {
        return Ended::Eof;
    }
    loop {
        match next_event(port, control, INFINITE) {
            Event::Pipe {
                ok: true,
                transferred,
            } if transferred > 0 => reader.push(control.received(transferred)),
            Event::Pipe { .. } => return Ended::Eof,
            Event::PortFailed => return Ended::PortFailed,
            Event::Job { .. } | Event::MemberExited | Event::Other => continue,
        }
        while let Some(frame) = reader.next_frame() {
            match frame {
                Frame::Exec(exec) if request.is_none() => request = Some(exec),
                Frame::Go => return request.map_or(Ended::Cancel, Ended::Go),
                _ => return Ended::Cancel,
            }
        }
        // Only a consumed completion frees the one OVERLAPPED; a job message leaves the read pending.
        if !control.start_read() {
            return Ended::Eof;
        }
    }
}

/// Everything up to and including the join. A failure before the join drops a F that never held this process; a
/// failed verification after it leaves F open (`JoinedJob`), so the caller's report and exit code always land.
fn prepare(op: &OpId, control: &Control) -> Result<(JoinedJob, Owned), (String, Exit)> {
    let attributes = security::job_attributes()
        .map_err(|error| (format!("sd-failed {error}"), Exit::SecurityDescriptor))?;
    let floor = job::create(&op.job_name(), &attributes).map_err(|error| error.describe())?;
    // SAFETY: creates a new port with one concurrent thread; no file handle is associated yet.
    let port =
        Owned::new(unsafe { CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1) })
            .ok_or_else(|| JobError::Port(last_error()).describe())?;
    floor
        .associate_port(port.raw(), JOB_KEY)
        .map_err(|error| error.describe())?;
    control
        .associate(port.raw(), PIPE_KEY)
        .map_err(|error| JobError::Port(error).describe())?;
    let joined = floor.join_self().map_err(|error| error.describe())?;
    Ok((joined, port))
}

pub fn run(op: &OpId, linger_ms: u32) -> Exit {
    // SAFETY: plain queries about this process.
    let (pid, created) = unsafe { (GetCurrentProcessId(), creation_time(GetCurrentProcess())) };
    let Ok(created) = created else {
        return Exit::SelfId;
    };
    let Ok(mut control) = control::connect(op) else {
        return Exit::Pipe;
    };
    let (floor, port) = match prepare(op, &control) {
        Ok(ready) => ready,
        Err((detail, exit)) => {
            control.report(&format!("error {detail}"));
            return exit;
        }
    };
    if !control.report(&format!("joined {pid} {created}")) {
        return Exit::Cancelled;
    }
    let mut reader = FrameReader::default();
    let request = match await_go(&mut control, port.raw(), &mut reader) {
        Ended::Go(request) => request,
        Ended::Cancel => {
            control.report("cancelled");
            return Exit::Cancelled;
        }
        Ended::Eof => return Exit::Cancelled,
        Ended::PortFailed => return Exit::PortFailed,
    };
    let root = match spawn::spawn_root(&request) {
        Ok(root) => root,
        Err(error) => {
            control.report(&format!("spawn-failed {error}"));
            return Exit::SpawnFailed;
        }
    };
    control.report(&format!("spawned {} {}", root.pid, root.created));
    spawn::close_standard_handles();
    running(
        &mut control,
        &floor,
        port.raw(),
        &root,
        &mut reader,
        linger_ms,
    )
}

fn handle_frames(reader: &mut FrameReader, root: &Root) {
    while let Some(frame) = reader.next_frame() {
        if frame == Frame::TerminateRoot {
            // SAFETY: the root handle is live; terminating an already-exited root fails harmlessly.
            unsafe { TerminateProcess(root.process.raw(), 1) };
        }
    }
}

fn root_exit_code(root: &Root) -> Option<u32> {
    // SAFETY: a zero-timeout wait on a live process handle.
    if unsafe { WaitForSingleObject(root.process.raw(), 0) } != WAIT_OBJECT_0 {
        return None;
    }
    let mut code = 0u32;
    // SAFETY: `code` is a writable u32.
    unsafe { GetExitCodeProcess(root.process.raw(), &mut code) };
    Some(code)
}

/// RUNNING and LINGERING (section 7.2): never waits on the writer; reports go out best-effort. A member's
/// `EXIT_PROCESS` message is dequeued before F's count drops (kernel exit ordering row), so the count is re-read when
/// each member's process handle signals instead.
fn running(
    control: &mut Control,
    floor: &JoinedJob,
    port: HANDLE,
    root: &Root,
    reader: &mut FrameReader,
    linger_ms: u32,
) -> Exit {
    let mut members = MemberWaits::new(port);
    members.watch(root.pid);
    handle_frames(reader, root);
    control.start_read();
    let mut exited = false;
    let mut deadline: Option<Instant> = None;
    loop {
        match next_event(port, control, RECHECK_MS) {
            Event::Pipe {
                ok: true,
                transferred,
            } if transferred > 0 => {
                reader.push(control.received(transferred));
                handle_frames(reader, root);
                control.start_read();
            }
            Event::Job {
                message: JOB_OBJECT_MSG_NEW_PROCESS,
                pid,
            } => {
                if let Some(pid) = u32::try_from(pid).ok().filter(|&pid| pid != root.pid) {
                    members.watch(pid);
                }
            }
            Event::MemberExited => members.settle(floor),
            Event::Pipe { .. } | Event::Job { .. } | Event::Other => {}
            Event::PortFailed => {
                // Ends the operation and this process with the PortFailed code. Should the call fail, the return
                // below exits with that code and process rundown closes F, whose kill-on-close ends the rest.
                let _ended = floor.terminate(Exit::PortFailed.status());
                return Exit::PortFailed;
            }
        }
        if let Some(code) = root_exit_code(root).filter(|_| !exited) {
            exited = true;
            let lingering = floor.active() != Ok(1);
            control.report(&format!(
                "exit {code} {}",
                if lingering { "lingering" } else { "empty" }
            ));
            deadline =
                lingering.then(|| Instant::now() + Duration::from_millis(u64::from(linger_ms)));
        }
        if exited && floor.active() == Ok(1) {
            control.report("done");
            return Exit::Ok;
        }
        if deadline.is_some_and(|at| Instant::now() >= at) {
            control.report("linger-expired");
            if let Err(error) = floor.terminate(LINGER_KILL_CODE) {
                control.report(&format!("linger-kill-failed {error}"));
            }
            return Exit::LingerKill;
        }
    }
}
