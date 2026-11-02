use std::ptr::null_mut;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JobObjectBasicAccountingInformation, JobObjectBasicProcessIdList,
    JobObjectExtendedLimitInformation, OpenJobObjectW, QueryInformationJobObject,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
};
use windows_sys::Win32::System::SystemServices::JOB_OBJECT_QUERY;

use super::sddl::from_sddl;
use super::win::{last_error, wide, Owned};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Gone,
    Present { active: u32 },
    Error(u32),
}

/// `OpenJobObjectW(JOB_OBJECT_QUERY)` with the error read in the same frame.
pub fn open_query(name: &str) -> Result<Owned, u32> {
    let name = wide(name);
    // SAFETY: `name` is NUL-terminated.
    let raw = unsafe { OpenJobObjectW(JOB_OBJECT_QUERY, 0, name.as_ptr()) };
    let error = last_error();
    Owned::new(raw).ok_or(error)
}

/// Opens, reads the active count and closes the handle in one frame: the observer never keeps an F handle.
pub fn state(name: &str) -> State {
    match open_query(name) {
        Ok(job) => accounting(job.raw()).map_or_else(
            || State::Error(last_error()),
            |info| State::Present {
                active: info.ActiveProcesses,
            },
        ),
        Err(ERROR_FILE_NOT_FOUND) => State::Gone,
        Err(error) => State::Error(error),
    }
}

/// Probes `state` in a bounded loop until the name is gone (design N2(b)/N3: the probe is the event source).
pub fn wait_gone(name: &str, bound: Duration) -> Option<Instant> {
    let deadline = Instant::now() + bound;
    while Instant::now() < deadline {
        if state(name) == State::Gone {
            return Some(Instant::now());
        }
        std::thread::yield_now();
    }
    None
}

pub fn accounting(job: HANDLE) -> Option<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION> {
    // SAFETY: a plain C struct for which all-zero is valid.
    let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
    let size = u32::try_from(std::mem::size_of_val(&info)).unwrap_or(0);
    // SAFETY: `info` is writable for `size` bytes.
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformation,
            std::ptr::from_mut(&mut info).cast(),
            size,
            null_mut(),
        )
    };
    (ok != 0).then_some(info)
}

pub fn limit_flags(job: HANDLE) -> Option<u32> {
    // SAFETY: a plain C struct for which all-zero is valid.
    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    let size = u32::try_from(std::mem::size_of_val(&info)).unwrap_or(0);
    // SAFETY: `info` is writable for `size` bytes.
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_mut(&mut info).cast(),
            size,
            null_mut(),
        )
    };
    (ok != 0).then_some(info.BasicLimitInformation.LimitFlags)
}

#[repr(C)]
struct PidList {
    assigned: u32,
    listed: u32,
    pids: [usize; 1024],
}

pub fn pid_list(job: HANDLE) -> Vec<u32> {
    let mut list = PidList {
        assigned: 0,
        listed: 0,
        pids: [0; 1024],
    };
    let size = u32::try_from(std::mem::size_of::<PidList>()).unwrap_or(0);
    // SAFETY: `list` has the JOBOBJECT_BASIC_PROCESS_ID_LIST layout and is writable for `size` bytes.
    let ok = unsafe {
        QueryInformationJobObject(
            job,
            JobObjectBasicProcessIdList,
            std::ptr::from_mut(&mut list).cast(),
            size,
            null_mut(),
        )
    };
    assert!(
        ok != 0,
        "JobObjectBasicProcessIdList failed {}",
        last_error()
    );
    let listed = usize::try_from(list.listed).unwrap_or(0).min(1024);
    list.pids[..listed]
        .iter()
        .map(|&pid| u32::try_from(pid).unwrap_or(0))
        .collect()
}

/// `CreateJobObjectW` with the last error captured in-frame: `(handle, error)`.
pub fn create(name: &str, sddl: Option<&str>) -> (Option<Owned>, u32) {
    let name = wide(name);
    let attributes = sddl.map(|text| from_sddl(text).expect("job SDDL"));
    let attributes_ptr = attributes.as_ref().map_or(std::ptr::null(), |owned| {
        std::ptr::from_ref(&owned.attributes)
    });
    // SAFETY: `name` is NUL-terminated and `attributes` outlives the call.
    let raw = unsafe { CreateJobObjectW(attributes_ptr, name.as_ptr()) };
    let error = last_error();
    (Owned::new(raw), error)
}
