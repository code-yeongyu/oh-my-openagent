//! The writer's control pipe, client side (design v4.2 section 6.1 Control channel). Reads complete on the
//! completion port; writes wait on their own event, bounded, and never post to it.
use std::cell::Cell;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{
    ERROR_IO_PENDING, GENERIC_READ, GENERIC_WRITE, HANDLE, WAIT_OBJECT_0,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, OPEN_EXISTING, SECURITY_IDENTIFICATION,
    SECURITY_SQOS_PRESENT,
};
use windows_sys::Win32::System::Pipes::{SetNamedPipeHandleState, PIPE_READMODE_BYTE};
use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows_sys::Win32::System::IO::{
    CancelIoEx, CreateIoCompletionPort, GetOverlappedResult, OVERLAPPED,
};

use crate::cli::OpId;
use crate::win::{last_error, wide, Owned};

const READ_SIZE: usize = 4096;
/// The longest one report may wait for the writer to take it. A writer's inbound buffer normally absorbs a report at
/// once; one that stopped reading costs at most this long, and every later report is dropped, so no report can hold
/// the linger deadline or any other exit hostage.
const REPORT_WRITE_MS: u32 = 5_000;

/// One outstanding read. Boxed so its address is stable while the kernel owns it.
struct PendingRead {
    overlapped: OVERLAPPED,
    buffer: [u8; READ_SIZE],
}

pub struct Control {
    pipe: Owned,
    write_event: Owned,
    read: Box<PendingRead>,
    stalled: Cell<bool>,
}

pub fn connect(op: &OpId) -> Result<Control, u32> {
    let name = wide(&op.pipe_name());
    // SECURITY_IDENTIFICATION: the pipe's server may identify this process but never act with its token.
    let flags = FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION;
    // SAFETY: `name` is NUL-terminated; the handle is created non-inheritable (no security attributes).
    let raw = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            flags,
            null_mut(),
        )
    };
    let pipe = Owned::new(raw).ok_or_else(last_error)?;
    let mode = PIPE_READMODE_BYTE;
    // SAFETY: `pipe` is a live pipe handle; only the read mode is set.
    if unsafe { SetNamedPipeHandleState(pipe.raw(), &mode, null(), null()) } == 0 {
        return Err(last_error());
    }
    // SAFETY: a manual-reset, unnamed, non-signaled event.
    let write_event =
        Owned::new(unsafe { CreateEventW(null(), 1, 0, null()) }).ok_or_else(last_error)?;
    // SAFETY: OVERLAPPED is a plain C struct for which all-zero is valid.
    let read = Box::new(PendingRead {
        overlapped: unsafe { std::mem::zeroed() },
        buffer: [0; READ_SIZE],
    });
    Ok(Control {
        pipe,
        write_event,
        read,
        stalled: Cell::new(false),
    })
}

impl Control {
    pub fn associate(&self, port: HANDLE, key: usize) -> Result<(), u32> {
        // SAFETY: both handles are live; associating a file handle with an existing port returns that port.
        let ok = !unsafe { CreateIoCompletionPort(self.pipe.raw(), port, key, 0) }.is_null();
        if ok {
            Ok(())
        } else {
            Err(last_error())
        }
    }

    /// Writes one report frame and waits for it, at most `REPORT_WRITE_MS`. False when the writer is gone or stopped
    /// reading; after the first stalled write every later report returns false at once. Reports after `go` ignore it.
    pub fn report(&self, frame: &str) -> bool {
        if self.stalled.get() {
            return false;
        }
        let bytes = format!("{frame}\n");
        let Ok(length) = u32::try_from(bytes.len()) else {
            return false;
        };
        // SAFETY: OVERLAPPED is a plain C struct for which all-zero is valid.
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        // The low-order bit keeps this completion off the port (GetQueuedCompletionStatus documentation).
        overlapped.hEvent = self.write_event.raw().map_addr(|address| address | 1);
        // SAFETY: `bytes` and `overlapped` outlive the operation, which completes or is cancelled and drained below.
        let started = unsafe {
            WriteFile(
                self.pipe.raw(),
                bytes.as_ptr(),
                length,
                null_mut(),
                &mut overlapped,
            )
        } != 0;
        if !started && last_error() != ERROR_IO_PENDING {
            return false;
        }
        // SAFETY: a bounded wait on this write's own event, which WriteFile reset when it started.
        let in_time = unsafe { WaitForSingleObject(self.write_event.raw(), REPORT_WRITE_MS) }
            == WAIT_OBJECT_0;
        if !in_time {
            // SAFETY: cancels this exact write; the drain below completes it before `overlapped` goes away.
            unsafe { CancelIoEx(self.pipe.raw(), &overlapped) };
        }
        let mut written = 0u32;
        // SAFETY: waits for this operation to finish (completed or cancelled); `overlapped` is still alive.
        let done =
            unsafe { GetOverlappedResult(self.pipe.raw(), &overlapped, &mut written, 1) } != 0;
        let delivered = done && written == length;
        self.stalled.set(!delivered && !in_time);
        delivered
    }

    /// Issues the next read; its completion arrives on the port. False when the pipe is already broken (EOF).
    pub fn start_read(&mut self) -> bool {
        // SAFETY: as above.
        self.read.overlapped = unsafe { std::mem::zeroed() };
        let length = u32::try_from(READ_SIZE).unwrap_or(0);
        // SAFETY: the boxed buffer and OVERLAPPED keep their address until the completion is dequeued.
        let started = unsafe {
            ReadFile(
                self.pipe.raw(),
                self.read.buffer.as_mut_ptr(),
                length,
                null_mut(),
                &mut self.read.overlapped,
            )
        } != 0;
        started || last_error() == ERROR_IO_PENDING
    }

    pub fn is_read(&self, overlapped: *mut OVERLAPPED) -> bool {
        std::ptr::eq(overlapped, &raw const self.read.overlapped)
    }

    /// The bytes of a completed read.
    pub fn received(&self, transferred: u32) -> &[u8] {
        let length = usize::try_from(transferred).unwrap_or(0).min(READ_SIZE);
        &self.read.buffer[..length]
    }
}
