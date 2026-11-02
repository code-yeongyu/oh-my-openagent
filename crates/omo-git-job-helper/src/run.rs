//! `run` mode, the operation helper H (design v4.2 sections 6.1, 7.2, 9, 10.2): F is created, limited, joined and
//! verified before anything is spawned; `AWAIT_GO` has no timer; root exit is reported `empty` or `lingering`.
use std::ptr::null_mut;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetCurrentProcessId, GetExitCodeProcess, TerminateProcess,
    WaitForSingleObject, INFINITE,
};
use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetQueuedCompletionStatus};

use crate::cli::{Exit, OpId, LINGER_KILL_CODE};
use crate::control::{self, Control};
use crate::frames::{ExecRequest, Frame, FrameReader};
use crate::job::{self, FloorJob, JobError};
use crate::security;
use crate::spawn::{self, Root};
use crate::win::{creation_time, last_error, Owned};

const JOB_KEY: usize = 1;
const PIPE_KEY: usize = 2;
/// Job notifications are documented as not guaranteed, so a running operation re-checks its state this often.
const RECHECK_MS: u32 = 250;

enum Event {
    Pipe { ok: bool, transferred: u32 },
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
            Event::Other => continue,
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

fn prepare(op: &OpId, control: &Control) -> Result<(FloorJob, Owned), (String, Exit)> {
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
    floor.join_self().map_err(|error| error.describe())?;
    Ok((floor, port))
}

/// Ends the process while F is still held: dropping the only handle first would let kill-on-close terminate H itself
/// (exit code 0) before its own code is set. Process rundown then closes F with nothing else left to kill.
fn exit_holding(_floor: &FloorJob, exit: Exit) -> ! {
    std::process::exit(exit.code())
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
        exit_holding(&floor, Exit::Cancelled);
    }
    let mut reader = FrameReader::default();
    let request = match await_go(&mut control, port.raw(), &mut reader) {
        Ended::Go(request) => request,
        Ended::Cancel => {
            control.report("cancelled");
            exit_holding(&floor, Exit::Cancelled);
        }
        Ended::Eof => exit_holding(&floor, Exit::Cancelled),
        Ended::PortFailed => exit_holding(&floor, Exit::PortFailed),
    };
    let root = match spawn::spawn_root(&request) {
        Ok(root) => root,
        Err(error) => {
            control.report(&format!("spawn-failed {error}"));
            exit_holding(&floor, Exit::SpawnFailed);
        }
    };
    control.report(&format!("spawned {} {}", root.pid, root.created));
    spawn::close_standard_handles();
    let exit = running(
        &mut control,
        &floor,
        port.raw(),
        &root,
        &mut reader,
        linger_ms,
    );
    exit_holding(&floor, exit)
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

/// RUNNING and LINGERING (section 7.2): never waits on the writer; reports go out best-effort.
fn running(
    control: &mut Control,
    floor: &FloorJob,
    port: HANDLE,
    root: &Root,
    reader: &mut FrameReader,
    linger_ms: u32,
) -> Exit {
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
            Event::Pipe { .. } | Event::Other => {}
            Event::PortFailed => {
                floor.terminate(1);
                return Exit::PortFailed;
            }
        }
        if let Some(code) = root_exit_code(root).filter(|_| !exited) {
            exited = true;
            let lingering = floor.active() != Some(1);
            control.report(&format!(
                "exit {code} {}",
                if lingering { "lingering" } else { "empty" }
            ));
            deadline =
                lingering.then(|| Instant::now() + Duration::from_millis(u64::from(linger_ms)));
        }
        if exited && floor.active() == Some(1) {
            control.report("done");
            return Exit::Ok;
        }
        if deadline.is_some_and(|at| Instant::now() >= at) {
            control.report("linger-expired");
            floor.terminate(LINGER_KILL_CODE);
            return Exit::LingerKillFailed;
        }
    }
}
