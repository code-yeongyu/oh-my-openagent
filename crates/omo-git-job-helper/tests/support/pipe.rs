use std::ptr::{null, null_mut};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, HANDLE, WAIT_OBJECT_0,
};
use windows_sys::Win32::Security::{
    GetTokenInformation, RevertToSelf, TokenImpersonationLevel, SECURITY_IMPERSONATION_LEVEL,
    TOKEN_QUERY,
};
use windows_sys::Win32::Storage::FileSystem::{
    ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, PIPE_ACCESS_DUPLEX,
};
use windows_sys::Win32::System::Pipes::ImpersonateNamedPipeClient;
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_WAIT,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, GetCurrentThread, OpenThreadToken, WaitForMultipleObjects,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

use super::sddl::from_sddl;
use super::win::{last_error, wide, Owned, PIPE_PREFIX};

pub enum Io {
    Done(u32),
    Timeout,
    Aborted,
    Failed(u32),
}

/// Waits for one overlapped operation on `handle`, bounded by `timeout` and cut short when `abort` signals.
/// A cut-short operation is cancelled and drained before return, so `overlapped` is never left in flight.
pub fn finish(
    handle: HANDLE,
    overlapped: &mut OVERLAPPED,
    started: bool,
    timeout: Duration,
    abort: Option<HANDLE>,
) -> Io {
    if !started {
        let error = last_error();
        if error != ERROR_IO_PENDING {
            return Io::Failed(error);
        }
        let mut waits = vec![overlapped.hEvent];
        waits.extend(abort);
        let millis = u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX - 1);
        let count = u32::try_from(waits.len()).unwrap_or(1);
        // SAFETY: `waits` holds live handles for the duration of the wait.
        let woke = unsafe { WaitForMultipleObjects(count, waits.as_ptr(), 0, millis) };
        if woke != WAIT_OBJECT_0 {
            let mut ignored = 0u32;
            // SAFETY: cancels and then drains this exact operation; `overlapped` stays alive across both calls.
            unsafe {
                CancelIoEx(handle, overlapped);
                GetOverlappedResult(handle, overlapped, &mut ignored, 1);
            }
            return if woke == WAIT_OBJECT_0 + 1 {
                Io::Aborted
            } else {
                Io::Timeout
            };
        }
    }
    let mut transferred = 0u32;
    // SAFETY: the operation has completed; this only reads its result.
    if unsafe { GetOverlappedResult(handle, overlapped, &mut transferred, 0) } == 0 {
        return Io::Failed(last_error());
    }
    Io::Done(transferred)
}

pub fn overlapped_with_event() -> (OVERLAPPED, Owned) {
    // SAFETY: a manual-reset, unnamed, initially non-signaled event.
    let event = Owned::new(unsafe { CreateEventW(null(), 1, 0, null()) }).expect("CreateEventW");
    // SAFETY: OVERLAPPED is a plain C struct for which all-zero is valid.
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    overlapped.hEvent = event.raw();
    (overlapped, event)
}

/// One server instance of `\\.\pipe\<suffix>`, the writer side of the helper's control channel.
pub struct ServerPipe {
    handle: Owned,
    pending: Vec<u8>,
}

impl ServerPipe {
    pub fn create(suffix: &str, sddl: Option<&str>, first: bool) -> Result<Self, u32> {
        Self::create_with_inbound_quota(suffix, sddl, first, 65536)
    }

    /// `inbound` is the quota for bytes the helper writes. With 0 a helper write pends until this side reads it,
    /// which is how a writer that stopped reading looks to the helper.
    pub fn create_with_inbound_quota(
        suffix: &str,
        sddl: Option<&str>,
        first: bool,
        inbound: u32,
    ) -> Result<Self, u32> {
        let name = wide(&format!("{PIPE_PREFIX}{suffix}"));
        let attributes = sddl.map(from_sddl).transpose()?;
        let attributes_ptr = attributes
            .as_ref()
            .map_or(null(), |owned| std::ptr::from_ref(&owned.attributes));
        let first_flag = if first {
            FILE_FLAG_FIRST_PIPE_INSTANCE
        } else {
            0
        };
        // SAFETY: `name` is NUL-terminated and `attributes` outlives the call.
        let raw = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | first_flag,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                255,
                65536,
                inbound,
                0,
                attributes_ptr,
            )
        };
        Owned::new(raw)
            .map(|handle| Self {
                handle,
                pending: Vec::new(),
            })
            .ok_or_else(last_error)
    }

    pub const fn raw(&self) -> HANDLE {
        self.handle.raw()
    }

    /// The impersonation level the connected client granted (its SQOS), read by impersonating it once. Requires
    /// that a frame was already read from the client.
    pub fn client_impersonation_level(&self) -> Result<SECURITY_IMPERSONATION_LEVEL, u32> {
        // SAFETY: the instance is connected and has received data.
        if unsafe { ImpersonateNamedPipeClient(self.raw()) } == 0 {
            return Err(last_error());
        }
        let mut token = null_mut();
        // SAFETY: this thread is impersonating; `token` receives a new handle. Reverted in the same frame.
        let opened =
            unsafe { OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, 1, &mut token) } != 0;
        let error = last_error();
        // SAFETY: ends the impersonation this function started.
        unsafe { RevertToSelf() };
        let token = Owned::new(token).filter(|_| opened).ok_or(error)?;
        let mut level: SECURITY_IMPERSONATION_LEVEL = 0;
        let mut returned = 0u32;
        let size = u32::try_from(std::mem::size_of_val(&level)).unwrap_or(4);
        // SAFETY: `level` is writable for `size` bytes.
        let ok = unsafe {
            GetTokenInformation(
                token.raw(),
                TokenImpersonationLevel,
                std::ptr::from_mut(&mut level).cast(),
                size,
                &mut returned,
            )
        };
        if ok == 0 {
            Err(last_error())
        } else {
            Ok(level)
        }
    }

    pub fn accept(&self, timeout: Duration, abort: Option<HANDLE>) -> Result<(), String> {
        let (mut overlapped, _event) = overlapped_with_event();
        // SAFETY: `overlapped` and its event stay alive until `finish` has drained the operation.
        let started = unsafe { ConnectNamedPipe(self.raw(), &mut overlapped) } != 0;
        if !started && last_error() == ERROR_PIPE_CONNECTED {
            return Ok(());
        }
        match finish(self.raw(), &mut overlapped, started, timeout, abort) {
            Io::Done(_) => Ok(()),
            Io::Timeout => Err(format!("no client connected within {timeout:?}")),
            Io::Aborted => Err("the client process exited before connecting".into()),
            Io::Failed(error) => Err(format!("ConnectNamedPipe failed {error}")),
        }
    }

    pub fn write(&self, bytes: &[u8]) -> Result<(), String> {
        let (mut overlapped, _event) = overlapped_with_event();
        let length = u32::try_from(bytes.len()).map_err(|_| "frame too large".to_owned())?;
        // SAFETY: `bytes` and `overlapped` stay alive until `finish` returns.
        let started = unsafe {
            WriteFile(
                self.raw(),
                bytes.as_ptr(),
                length,
                null_mut(),
                &mut overlapped,
            )
        } != 0;
        match finish(
            self.raw(),
            &mut overlapped,
            started,
            Duration::from_secs(10),
            None,
        ) {
            Io::Done(written) if written == length => Ok(()),
            Io::Done(written) => Err(format!("short write {written}/{length}")),
            Io::Timeout | Io::Aborted => Err("write did not complete within 10 s".into()),
            Io::Failed(error) => Err(format!("WriteFile failed {error}")),
        }
    }

    /// The next newline-terminated frame, or `Err("eof")` once the helper closed its end.
    pub fn read_line(&mut self, timeout: Duration) -> Result<String, String> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(end) = self.pending.iter().position(|&byte| byte == b'\n') {
                let line: Vec<u8> = self.pending.drain(..=end).collect();
                return Ok(String::from_utf8_lossy(&line[..end]).into_owned());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            let mut buffer = [0u8; 512];
            let (mut overlapped, _event) = overlapped_with_event();
            // SAFETY: `buffer` and `overlapped` stay alive until `finish` returns.
            let started = unsafe {
                ReadFile(
                    self.raw(),
                    buffer.as_mut_ptr(),
                    512,
                    null_mut(),
                    &mut overlapped,
                )
            } != 0;
            match finish(self.raw(), &mut overlapped, started, remaining, None) {
                Io::Done(0) | Io::Failed(_) => return Err("eof".into()),
                Io::Done(read) => self
                    .pending
                    .extend_from_slice(&buffer[..usize::try_from(read).unwrap_or(0)]),
                Io::Timeout | Io::Aborted => return Err(format!("no frame within {timeout:?}")),
            }
        }
    }
}
