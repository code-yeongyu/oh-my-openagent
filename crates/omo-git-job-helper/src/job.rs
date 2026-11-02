//! The floor job F (design v4.2 sections 1 and 6.1): create, limit, read back, join, verify.
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{ERROR_ALREADY_EXISTS, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
    JobObjectAssociateCompletionPortInformation, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECTINFOCLASS, JOBOBJECT_ASSOCIATE_COMPLETION_PORT,
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

use crate::cli::Exit;
use crate::security::JobAttributes;
use crate::win::{last_error, wide, Owned};

#[derive(Debug)]
pub enum JobError {
    Exists,
    Create(u32),
    Limits(u32),
    LimitsMismatch(u32),
    Port(u32),
    Assign(u32),
    Verify,
}

impl JobError {
    /// The `error <tag> <detail>` report and the exit code (section 6.1 failure column).
    pub fn describe(&self) -> (String, Exit) {
        match self {
            Self::Exists => ("job-exists 183".into(), Exit::JobExists),
            Self::Create(code) => (format!("job-create {code}"), Exit::JobCreate),
            Self::Limits(code) => (format!("limits {code}"), Exit::Limits),
            Self::LimitsMismatch(flags) => {
                (format!("limits-mismatch {flags:#x}"), Exit::LimitsMismatch)
            }
            Self::Port(code) => (format!("port {code}"), Exit::Port),
            Self::Assign(code) => (format!("assign {code}"), Exit::Assign),
            Self::Verify => ("verify-failed 0".into(), Exit::Verify),
        }
    }
}

/// The only handle to F (I3): created non-inheritable and never duplicated.
pub struct FloorJob(Owned);

fn size_of<T>() -> u32 {
    u32::try_from(std::mem::size_of::<T>()).unwrap_or(0)
}

/// Creates F with exactly KILL_ON_JOB_CLOSE and reads the limits back. An existing name is refused, never opened.
pub fn create(name: &str, attributes: &JobAttributes) -> Result<FloorJob, JobError> {
    let name = wide(name);
    // SAFETY: `name` is NUL-terminated; `attributes` carries bInheritHandle = FALSE and outlives the call.
    let raw = unsafe { CreateJobObjectW(&attributes.attributes, name.as_ptr()) };
    let error = last_error();
    let job = FloorJob(Owned::new(raw).ok_or(JobError::Create(error))?);
    if error == ERROR_ALREADY_EXISTS {
        return Err(JobError::Exists);
    }
    // SAFETY: a plain C struct for which all-zero is valid.
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    job.set(JobObjectExtendedLimitInformation, &limits)
        .map_err(JobError::Limits)?;
    // SAFETY: as above.
    let mut read_back: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    job.query(JobObjectExtendedLimitInformation, &mut read_back)
        .map_err(JobError::Limits)?;
    let flags = read_back.BasicLimitInformation.LimitFlags;
    if flags != JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE {
        return Err(JobError::LimitsMismatch(flags));
    }
    Ok(job)
}

impl FloorJob {
    /// Wraps a query-only handle (the probe's in-frame open) to reuse `active`; never used to set or terminate.
    pub const fn from_query_handle(handle: Owned) -> Self {
        Self(handle)
    }

    fn set<T>(&self, class: JOBOBJECTINFOCLASS, value: &T) -> Result<(), u32> {
        // SAFETY: `value` is the C struct this information class expects and is readable for its size.
        let ok = unsafe {
            SetInformationJobObject(
                self.0.raw(),
                class,
                std::ptr::from_ref(value).cast(),
                size_of::<T>(),
            )
        };
        if ok == 0 {
            Err(last_error())
        } else {
            Ok(())
        }
    }

    fn query<T>(&self, class: JOBOBJECTINFOCLASS, value: &mut T) -> Result<(), u32> {
        // SAFETY: `value` is the C struct this information class fills and is writable for its size.
        let ok = unsafe {
            QueryInformationJobObject(
                self.0.raw(),
                class,
                std::ptr::from_mut(value).cast(),
                size_of::<T>(),
                null_mut(),
            )
        };
        if ok == 0 {
            Err(last_error())
        } else {
            Ok(())
        }
    }

    pub fn associate_port(&self, port: HANDLE, key: usize) -> Result<(), JobError> {
        let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: std::ptr::without_provenance_mut(key),
            CompletionPort: port,
        };
        self.set(JobObjectAssociateCompletionPortInformation, &association)
            .map_err(JobError::Port)
    }

    /// Joins this process, then verifies membership and that it is F's only process (section 6.1 Join, Verify).
    pub fn join_self(&self) -> Result<(), JobError> {
        // SAFETY: both handles are live; the pseudo-handle names this process.
        if unsafe { AssignProcessToJobObject(self.0.raw(), GetCurrentProcess()) } == 0 {
            return Err(JobError::Assign(last_error()));
        }
        let mut member = 0;
        // SAFETY: `member` is a writable BOOL.
        let checked =
            unsafe { IsProcessInJob(GetCurrentProcess(), self.0.raw(), &mut member) } != 0;
        if !checked || member == 0 || self.active() != Some(1) {
            return Err(JobError::Verify);
        }
        Ok(())
    }

    pub fn active(&self) -> Option<u32> {
        // SAFETY: a plain C struct for which all-zero is valid.
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        self.query(JobObjectBasicAccountingInformation, &mut info)
            .ok()
            .map(|()| info.ActiveProcesses)
    }

    /// Ends every member, this process included.
    pub fn terminate(&self, code: u32) {
        // SAFETY: the job handle is live and carries JOB_OBJECT_TERMINATE (creator's full-access handle).
        unsafe { TerminateJobObject(self.0.raw(), code) };
    }
}
