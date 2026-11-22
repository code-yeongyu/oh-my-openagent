//! Spawning the operation's root (design v4.2 section 6.1 Spawn git): `CreateProcessW` from inside F, so the root
//! and everything it creates are F members from their first instruction (I1). Only the three standard handles are
//! inherited (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST`), so F's handle can never reach git (I3).
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{
    CloseHandle, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
    UpdateProcThreadAttribute, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT,
    EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

use crate::frames::ExecRequest;
use crate::win::{creation_time, last_error, wide, Owned};

pub struct Root {
    pub process: Owned,
    pub pid: u32,
    pub created: u64,
}

fn standard_handles() -> [HANDLE; 3] {
    // SAFETY: reads this process's standard handles; no memory is touched.
    unsafe {
        [
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        ]
    }
}

fn usable(handles: &[HANDLE; 3]) -> Vec<HANDLE> {
    let mut list: Vec<HANDLE> = handles
        .iter()
        .copied()
        .filter(|&handle| !handle.is_null() && handle != INVALID_HANDLE_VALUE)
        .collect();
    list.sort_by_key(|handle| handle.addr());
    list.dedup_by(|left, right| std::ptr::eq(*left, *right));
    list
}

/// An initialised attribute list holding the handle list; deleted on drop.
struct AttributeList(Vec<u64>);

impl AttributeList {
    fn with_handles(handles: &[HANDLE]) -> Result<Self, u32> {
        let mut size = 0usize;
        // SAFETY: the sizing call writes only `size`; its documented ERROR_INSUFFICIENT_BUFFER is expected.
        unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size) };
        let mut buffer = vec![0u64; size / 8 + 1];
        // SAFETY: `buffer` is at least `size` aligned, writable bytes.
        if unsafe { InitializeProcThreadAttributeList(buffer.as_mut_ptr().cast(), 1, 0, &mut size) }
            == 0
        {
            return Err(last_error());
        }
        let mut list = Self(buffer);
        let bytes = std::mem::size_of_val(handles);
        // SAFETY: `handles` outlives the CreateProcessW call that consumes this list (the caller holds both).
        let ok = unsafe {
            UpdateProcThreadAttribute(
                list.raw(),
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_ptr().cast(),
                bytes,
                null_mut(),
                null(),
            )
        };
        if ok == 0 {
            Err(last_error())
        } else {
            Ok(list)
        }
    }

    fn raw(&mut self) -> *mut core::ffi::c_void {
        self.0.as_mut_ptr().cast()
    }
}

impl Drop for AttributeList {
    fn drop(&mut self) {
        // SAFETY: the list was initialised by InitializeProcThreadAttributeList.
        unsafe { DeleteProcThreadAttributeList(self.raw()) };
    }
}

/// Spawns the root with the error read in-frame. On failure F still holds only this process.
pub fn spawn_root(request: &ExecRequest) -> Result<Root, u32> {
    let standard = standard_handles();
    let inherited = usable(&standard);
    for &handle in &inherited {
        // SAFETY: `handle` is one of this process's live standard handles.
        unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
    }
    let mut attributes = if inherited.is_empty() {
        None
    } else {
        Some(AttributeList::with_handles(&inherited)?)
    };
    // SAFETY: STARTUPINFOEXW and PROCESS_INFORMATION are plain C structs for which all-zero is valid.
    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = u32::try_from(std::mem::size_of::<STARTUPINFOEXW>()).unwrap_or(0);
    let mut flags = CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT;
    if let Some(list) = attributes.as_mut() {
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        [
            startup.StartupInfo.hStdInput,
            startup.StartupInfo.hStdOutput,
            startup.StartupInfo.hStdError,
        ] = standard;
        startup.lpAttributeList = list.raw();
        flags |= EXTENDED_STARTUPINFO_PRESENT;
    }
    let application = wide(&request.exe);
    let mut command_line = wide(&request.command_line);
    let cwd = (!request.cwd.is_empty()).then(|| wide(&request.cwd));
    // SAFETY: as above.
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: every string is NUL-terminated and outlives the call; `command_line` is writable as the API requires;
    // the startup block and its attribute list are live; the environment is inherited (NULL).
    let ok = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            i32::from(attributes.is_some()),
            flags,
            null(),
            cwd.as_ref().map_or(null(), |path| path.as_ptr()),
            &startup.StartupInfo,
            &mut info,
        )
    };
    let error = last_error();
    drop(attributes);
    if ok == 0 {
        return Err(error);
    }
    drop(Owned::new(info.hThread));
    let process = Owned::new(info.hProcess).ok_or(error)?;
    let created = creation_time(process.raw())?;
    Ok(Root {
        process,
        pid: info.dwProcessId,
        created,
    })
}

/// After the spawn the helper keeps none of the writer's pipes open (section 6.1 After spawn).
pub fn close_standard_handles() {
    for handle in usable(&standard_handles()) {
        // SAFETY: each distinct standard handle is closed once; nothing in this process uses them afterwards.
        unsafe { CloseHandle(handle) };
    }
}
