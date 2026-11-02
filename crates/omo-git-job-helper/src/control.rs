//! The writer's control pipe, client side (design v4.2 section 6.1 Control channel). Reads complete on the
//! completion port; writes are synchronous and never post to it.
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{ERROR_IO_PENDING, GENERIC_READ, GENERIC_WRITE, HANDLE};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, OPEN_EXISTING,
};
use windows_sys::Win32::System::Pipes::{SetNamedPipeHandleState, PIPE_READMODE_BYTE};
use windows_sys::Win32::System::Threading::CreateEventW;
use windows_sys::Win32::System::IO::{CreateIoCompletionPort, GetOverlappedResult, OVERLAPPED};

use crate::cli::OpId;
use crate::win::{last_error, wide, Owned};

const READ_SIZE: usize = 4096;

/// One outstanding read. Boxed so its address is stable while the kernel owns it.
struct PendingRead {
    overlapped: OVERLAPPED,
    buffer: [u8; READ_SIZE],
}

pub struct Control {
    pipe: Owned,
    write_event: Owned,
    read: Box<PendingRead>,
}

pub fn connect(op: &OpId) -> Result<Control, u32> {
    let name = wide(&op.pipe_name());
    // SAFETY: `name` is NUL-terminated; the handle is created non-inheritable (no security attributes).
    let raw = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED,
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

    /// Writes one report frame and waits for it. False when the writer is gone; reports after `go` ignore that.
    pub fn report(&self, frame: &str) -> bool {
        let bytes = format!("{frame}\n");
        let Ok(length) = u32::try_from(bytes.len()) else {
            return false;
        };
        // SAFETY: OVERLAPPED is a plain C struct for which all-zero is valid.
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        // The low-order bit keeps this completion off the port (GetQueuedCompletionStatus documentation).
        overlapped.hEvent = self.write_event.raw().map_addr(|address| address | 1);
        // SAFETY: `bytes` and `overlapped` outlive the wait below, which completes the operation.
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
        let mut written = 0u32;
        // SAFETY: waits for this exact operation; `overlapped` is still alive.
        let done =
            unsafe { GetOverlappedResult(self.pipe.raw(), &overlapped, &mut written, 1) } != 0;
        done && written == length
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
