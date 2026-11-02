//! N6 (design section 20): a member's handle table, filtered to job objects, compared object-to-object with F.
use std::ptr::null_mut;

use windows_sys::Wdk::Foundation::{NtQueryObject, ObjectBasicInformation, ObjectTypeInformation};
use windows_sys::Wdk::System::Threading::{NtQueryInformationProcess, ProcessHandleInformation};
use windows_sys::Win32::Foundation::{
    CompareObjectHandles, DuplicateHandle, DUPLICATE_SAME_ACCESS, ERROR_INVALID_HANDLE, HANDLE,
    STATUS_INFO_LENGTH_MISMATCH,
};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, PROCESS_DUP_HANDLE, PROCESS_QUERY_INFORMATION,
};

use super::process;
use super::win::{last_error, Owned};

#[repr(C)]
#[derive(Clone, Copy)]
struct TableEntry {
    handle: HANDLE,
    handle_count: usize,
    pointer_count: usize,
    granted_access: u32,
    type_index: u32,
    attributes: u32,
    reserved: u32,
}

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
}

/// The documented prefix of OBJECT_TYPE_INFORMATION up to `TypeIndex` (Windows 8.1+).
#[repr(C)]
struct TypeInformation {
    type_name: UnicodeString,
    counters: [u32; 12],
    invalid_attributes: u32,
    generic_mapping: [u32; 4],
    valid_access_mask: u32,
    security_required: u8,
    maintain_handle_count: u8,
    type_index: u8,
}

/// (type name, type index) of the object behind `handle`.
pub fn object_type(handle: HANDLE) -> (String, u32) {
    let mut buffer = vec![0u64; 512];
    let size = u32::try_from(buffer.len() * 8).unwrap_or(0);
    // SAFETY: `buffer` is 4 KiB of aligned, writable memory, enough for the type record and its name.
    let status = unsafe {
        NtQueryObject(
            handle,
            ObjectTypeInformation,
            buffer.as_mut_ptr().cast(),
            size,
            null_mut(),
        )
    };
    assert!(
        status >= 0,
        "NtQueryObject(ObjectTypeInformation) status {status:#x}"
    );
    // SAFETY: on success the buffer starts with OBJECT_TYPE_INFORMATION; its name points inside the same buffer.
    unsafe {
        let info = &*buffer.as_ptr().cast::<TypeInformation>();
        let units = usize::from(info.type_name.length / 2);
        let name =
            String::from_utf16_lossy(std::slice::from_raw_parts(info.type_name.buffer, units));
        (name, u32::from(info.type_index))
    }
}

fn table(process: HANDLE) -> Vec<TableEntry> {
    let mut buffer = vec![0u64; 8192];
    loop {
        let size = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
        let mut needed = 0u32;
        // SAFETY: `buffer` is writable for `size` bytes and 8-byte aligned.
        let status = unsafe {
            NtQueryInformationProcess(
                process,
                ProcessHandleInformation,
                buffer.as_mut_ptr().cast(),
                size,
                &mut needed,
            )
        };
        if status == STATUS_INFO_LENGTH_MISMATCH {
            buffer.resize(usize::try_from(needed).unwrap_or(0) / 8 + 1024, 0);
            continue;
        }
        assert!(
            status >= 0,
            "NtQueryInformationProcess(ProcessHandleInformation) status {status:#x}"
        );
        // SAFETY: PROCESS_HANDLE_SNAPSHOT_INFORMATION is {NumberOfHandles, Reserved, Handles[]}; the kernel wrote
        // NumberOfHandles entries after the two header words, all inside `buffer`.
        return unsafe {
            let count = usize::try_from(*buffer.as_ptr()).unwrap_or(0);
            std::slice::from_raw_parts(buffer.as_ptr().add(2).cast::<TableEntry>(), count).to_vec()
        };
    }
}

pub struct MemberScan {
    pub pid: u32,
    pub image: String,
    pub job_handles: usize,
    pub refers_to_f: usize,
    pub reenumerated: bool,
}

/// Duplicates each job-type handle of `pid` and compares it with `f`. An invalid-handle duplicate means the handle
/// closed after enumeration (D6): that member's table is enumerated once more. Any other duplicate error panics.
pub fn scan_member(pid: u32, f: HANDLE, job_type: u32) -> MemberScan {
    let member = process::open(pid, PROCESS_DUP_HANDLE | PROCESS_QUERY_INFORMATION)
        .expect("open member for its handle table");
    let image = process::image_path(member.raw());
    let mut reenumerated = false;
    loop {
        let entries: Vec<TableEntry> = table(member.raw())
            .into_iter()
            .filter(|entry| entry.type_index == job_type)
            .collect();
        let mut refers_to_f = 0usize;
        let mut vanished = false;
        for entry in &entries {
            let mut duplicate = null_mut();
            // SAFETY: duplicates a handle value from the member's table into this process; the copy is owned below.
            let ok = unsafe {
                DuplicateHandle(
                    member.raw(),
                    entry.handle,
                    GetCurrentProcess(),
                    &mut duplicate,
                    0,
                    0,
                    DUPLICATE_SAME_ACCESS,
                )
            };
            if ok == 0 {
                let error = last_error();
                assert_eq!(
                    error, ERROR_INVALID_HANDLE,
                    "DuplicateHandle of a job handle in pid {pid} failed {error}"
                );
                vanished = true;
                continue;
            }
            let duplicate = Owned(duplicate);
            // SAFETY: both handles are live; the call compares the objects they name.
            if unsafe { CompareObjectHandles(duplicate.raw(), f) } != 0 {
                refers_to_f += 1;
            }
        }
        if !vanished || reenumerated {
            return MemberScan {
                pid,
                image,
                job_handles: entries.len(),
                refers_to_f,
                reenumerated,
            };
        }
        reenumerated = true;
    }
}

/// `HandleCount` of the object behind `handle` (PUBLIC_OBJECT_BASIC_INFORMATION); the caller's own handle counts.
pub fn handle_count(handle: HANDLE) -> Option<u32> {
    let mut info = [0u32; 14];
    // SAFETY: `info` is the 56-byte PUBLIC_OBJECT_BASIC_INFORMATION, writable and aligned.
    let status = unsafe {
        NtQueryObject(
            handle,
            ObjectBasicInformation,
            info.as_mut_ptr().cast(),
            56,
            null_mut(),
        )
    };
    (status >= 0).then_some(info[2])
}
