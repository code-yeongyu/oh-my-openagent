use std::path::PathBuf;
use std::time::Duration;

use windows_sys::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
    WaitForSingleObject, PROCESS_ACCESS_RIGHTS, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};

use super::win::Owned;

pub const WATCH: PROCESS_ACCESS_RIGHTS =
    PROCESS_SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION;

pub fn open(pid: u32, access: PROCESS_ACCESS_RIGHTS) -> Option<Owned> {
    // SAFETY: plain open by pid; the result is checked by `Owned::new`.
    Owned::new(unsafe { OpenProcess(access, 0, pid) })
}

pub fn signaled_within(process: HANDLE, bound: Duration) -> bool {
    let millis = u32::try_from(bound.as_millis()).unwrap_or(u32::MAX - 1);
    // SAFETY: a bounded wait on a live process handle.
    unsafe { WaitForSingleObject(process, millis) == WAIT_OBJECT_0 }
}

pub fn exit_code(process: HANDLE) -> Option<u32> {
    let mut code = 0u32;
    // SAFETY: `code` is a writable u32.
    (unsafe { GetExitCodeProcess(process, &mut code) } != 0).then_some(code)
}

pub fn terminate(process: HANDLE) {
    // SAFETY: best-effort cleanup on a handle opened with PROCESS_TERMINATE; failure means it already exited.
    unsafe { TerminateProcess(process, 1) };
}

pub fn image_path(process: HANDLE) -> String {
    let mut buffer = [0u16; 1024];
    let mut length = 1024u32;
    // SAFETY: `buffer` is writable for `length` UTF-16 units.
    let ok = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            buffer.as_mut_ptr(),
            &mut length,
        )
    };
    if ok == 0 {
        return String::from("<unreadable>");
    }
    String::from_utf16_lossy(&buffer[..usize::try_from(length).unwrap_or(0)])
}

/// Live processes whose image file name is `image`. Live means at least one thread (E1, round-3 v4.2 check): an
/// exited process whose object an observer still references stays listed with `cntThreads == 0`.
pub fn live_by_image(image: &str) -> Vec<u32> {
    // SAFETY: a process snapshot; the handle is owned below.
    let snapshot = Owned::new(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })
        .expect("CreateToolhelp32Snapshot");
    // SAFETY: a plain C struct for which all-zero is valid.
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(0);
    let mut live = Vec::new();
    // SAFETY: `entry` is writable and carries its size.
    let mut more = unsafe { Process32FirstW(snapshot.raw(), &mut entry) } != 0;
    while more {
        let length = entry
            .szExeFile
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(entry.szExeFile.len());
        let name = String::from_utf16_lossy(&entry.szExeFile[..length]);
        if entry.cntThreads > 0 && name.eq_ignore_ascii_case(image) {
            live.push(entry.th32ProcessID);
        }
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot.raw(), &mut entry) } != 0;
    }
    live
}

/// Cleanup for a failed row: terminates every live process with this image so the next row starts clean.
pub fn kill_image(image: &str) {
    for pid in live_by_image(image) {
        if let Some(process) = open(pid, WATCH) {
            terminate(process.raw());
        }
    }
}

pub fn find_on_path(file: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|dir| dir.join(file))
            .find(|path| path.is_file())
    })
}
