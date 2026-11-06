//! Test-only Win32 plumbing shared by the contract rows (tests/) and the testkit images (examples/).
//! Nothing here ships; it is written independently of the helper's own wrappers so an observer never
//! trusts the code under test.
#![allow(
    dead_code,
    reason = "each test binary and image uses a different subset"
)]

use std::ffi::c_void;
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_PIPE_BUSY, FILETIME, GENERIC_READ, GENERIC_WRITE, HANDLE,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::Storage::FileSystem::{CreateFileW, ReadFile, WriteFile, OPEN_EXISTING};
use windows_sys::Win32::System::Pipes::WaitNamedPipeW;
use windows_sys::Win32::System::Threading::{
    CreateProcessW, GetProcessTimes, Sleep, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION,
    STARTUPINFOW,
};

pub const PIPE_PREFIX: &str = r"\\.\pipe\";
pub const JOB_PREFIX: &str = r"Global\omo-memory-git-";

pub struct Owned(pub HANDLE);

// SAFETY: a kernel handle value is process-wide; any thread may wait on or close it.
unsafe impl Send for Owned {}
// SAFETY: as above; the wrappers only pass the value to thread-safe kernel calls.
unsafe impl Sync for Owned {}

impl Owned {
    pub fn new(raw: HANDLE) -> Option<Self> {
        (!raw.is_null() && raw != INVALID_HANDLE_VALUE).then_some(Self(raw))
    }

    pub const fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: the value came from a successful kernel call and is closed exactly once, here.
        unsafe { CloseHandle(self.0) };
    }
}

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn last_error() -> u32 {
    // SAFETY: reads the calling thread's last-error value; no memory is touched.
    unsafe { GetLastError() }
}

pub fn filetime_u64(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

pub fn creation_time(process: HANDLE) -> Option<u64> {
    let mut created = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut other = [FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    }; 3];
    let [exit, kernel, user] = &mut other;
    // SAFETY: every out pointer is a live, writable FILETIME owned by this frame.
    let ok = unsafe { GetProcessTimes(process, &mut created, exit, kernel, user) };
    (ok != 0).then(|| filetime_u64(created))
}

/// MSVC argv quoting (the rules `CommandLineToArgvW` and the CRT parse), so a test can hand the helper an exact
/// command line.
pub fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\u{b}', '"']) {
        return arg.to_owned();
    }
    let mut quoted = String::from("\"");
    let mut backslashes = 0usize;
    for ch in arg.chars() {
        if ch == '\\' {
            backslashes += 1;
            continue;
        }
        let repeat = if ch == '"' {
            backslashes * 2 + 1
        } else {
            backslashes
        };
        quoted.extend(std::iter::repeat_n('\\', repeat));
        backslashes = 0;
        quoted.push(ch);
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

pub fn command_line(args: &[&str]) -> String {
    args.iter()
        .map(|arg| quote_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

/// `CreateProcessW` without handle inheritance. Returns the process handle and pid, or the in-frame error.
pub fn spawn(
    exe: &Path,
    args: &[&str],
    flags: PROCESS_CREATION_FLAGS,
) -> Result<(Owned, u32), u32> {
    let exe_text = exe.to_string_lossy();
    let mut line_args = vec![exe_text.as_ref()];
    line_args.extend_from_slice(args);
    let application = wide(&exe_text);
    let mut line = wide(&command_line(&line_args));
    // SAFETY: STARTUPINFOW and PROCESS_INFORMATION are plain C structs for which all-zero is a valid value.
    let mut startup: STARTUPINFOW = unsafe { std::mem::zeroed() };
    startup.cb = u32::try_from(std::mem::size_of::<STARTUPINFOW>()).unwrap_or(u32::MAX);
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
            flags,
            null(),
            null(),
            &startup,
            &mut info,
        )
    };
    if ok == 0 {
        return Err(last_error());
    }
    drop(Owned(info.hThread));
    Ok((Owned(info.hProcess), info.dwProcessId))
}

/// Connects to `\\.\pipe\<suffix>`, retrying for as long as it takes: a testkit child never gives up on its own.
pub fn connect_forever(suffix: &str) -> Owned {
    let name = wide(&format!("{PIPE_PREFIX}{suffix}"));
    loop {
        // SAFETY: `name` is NUL-terminated; no security attributes or template handle are passed.
        let raw = unsafe {
            CreateFileW(
                name.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                0,
                null(),
                OPEN_EXISTING,
                0,
                null_mut(),
            )
        };
        if let Some(pipe) = Owned::new(raw) {
            return pipe;
        }
        match last_error() {
            // SAFETY: `name` is NUL-terminated.
            ERROR_PIPE_BUSY => unsafe {
                WaitNamedPipeW(name.as_ptr(), 1000);
            },
            // SAFETY: plain sleep; the server has no free instance yet (ERROR_FILE_NOT_FOUND) or is restarting.
            _ => unsafe { Sleep(5) },
        }
    }
}

pub fn write_all(handle: HANDLE, bytes: &[u8]) -> bool {
    let Ok(length) = u32::try_from(bytes.len()) else {
        return false;
    };
    let mut written = 0u32;
    // SAFETY: `bytes` is valid for `length` bytes; synchronous write on a non-overlapped handle.
    let ok = unsafe { WriteFile(handle, bytes.as_ptr(), length, &mut written, null_mut()) };
    ok != 0 && written == length
}

pub fn read_until_eof(handle: HANDLE) -> usize {
    let mut total = 0usize;
    let mut buffer = [0u8; 256];
    loop {
        let mut read = 0u32;
        // SAFETY: `buffer` is writable for its full length; synchronous read on a non-overlapped handle.
        let ok = unsafe { ReadFile(handle, buffer.as_mut_ptr(), 256, &mut read, null_mut()) };
        if ok == 0 || read == 0 {
            return total;
        }
        total += usize::try_from(read).unwrap_or(0);
    }
}

pub const fn as_void<T>(value: &T) -> *const c_void {
    std::ptr::from_ref(value).cast()
}
