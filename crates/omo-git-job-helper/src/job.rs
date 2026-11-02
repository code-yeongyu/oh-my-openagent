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
    set(job.0.raw(), JobObjectExtendedLimitInformation, &limits).map_err(JobError::Limits)?;
    // SAFETY: as above.
    let mut read_back: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    query(
        job.0.raw(),
        JobObjectExtendedLimitInformation,
        &mut read_back,
    )
    .map_err(JobError::Limits)?;
    let flags = read_back.BasicLimitInformation.LimitFlags;
    if flags != JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE {
        return Err(JobError::LimitsMismatch(flags));
    }
    Ok(job)
}

fn set<T>(job: HANDLE, class: JOBOBJECTINFOCLASS, value: &T) -> Result<(), u32> {
    // SAFETY: `value` is the C struct this information class expects and is readable for its size.
    let ok = unsafe {
        SetInformationJobObject(job, class, std::ptr::from_ref(value).cast(), size_of::<T>())
    };
    if ok == 0 {
        Err(last_error())
    } else {
        Ok(())
    }
}

fn query<T>(job: HANDLE, class: JOBOBJECTINFOCLASS, value: &mut T) -> Result<(), u32> {
    // SAFETY: `value` is the C struct this information class fills and is writable for its size.
    let ok = unsafe {
        QueryInformationJobObject(
            job,
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

/// F's active process count, or the error code read in the same frame as the failed query.
fn active(job: HANDLE) -> Result<u32, u32> {
    // SAFETY: a plain C struct for which all-zero is valid.
    let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
    query(job, JobObjectBasicAccountingInformation, &mut info).map(|()| info.ActiveProcesses)
}

impl FloorJob {
    /// Wraps a query-only handle (the probe's in-frame open) to reuse `active`; never used to set or terminate.
    pub const fn from_query_handle(handle: Owned) -> Self {
        Self(handle)
    }

    pub fn associate_port(&self, port: HANDLE, key: usize) -> Result<(), JobError> {
        let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: std::ptr::without_provenance_mut(key),
            CompletionPort: port,
        };
        set(
            self.0.raw(),
            JobObjectAssociateCompletionPortInformation,
            &association,
        )
        .map_err(JobError::Port)
    }

    pub fn active(&self) -> Result<u32, u32> {
        active(self.0.raw())
    }

    /// Joins this process, then verifies membership and that it is F's only process (section 6.1 Join, Verify).
    /// From a successful assignment on, the handle is a `JoinedJob` that this process never closes, so a failed
    /// verification still leaves F open and the caller reports and exits with its own code.
    pub fn join_self(self) -> Result<JoinedJob, JobError> {
        // SAFETY: both handles are live; the pseudo-handle names this process.
        if unsafe { AssignProcessToJobObject(self.0.raw(), GetCurrentProcess()) } == 0 {
            return Err(JobError::Assign(last_error()));
        }
        let joined = JoinedJob(self.0.into_raw());
        let mut member = 0;
        // SAFETY: `member` is a writable BOOL.
        let checked = unsafe { IsProcessInJob(GetCurrentProcess(), joined.0, &mut member) } != 0;
        if !checked || member == 0 || joined.active() != Ok(1) {
            return Err(JobError::Verify);
        }
        Ok(joined)
    }
}

/// F once this process is a member. It holds F's only handle and has no `Drop`: closing that handle would let
/// kill-on-close end this process before its exit code is set, so only process rundown closes it (I4; design 6.1
/// Done). Every return path after the join therefore exits with the code it chose.
pub struct JoinedJob(HANDLE);

impl JoinedJob {
    pub fn active(&self) -> Result<u32, u32> {
        active(self.0)
    }

    /// Ends every member, this process included, with `code`.
    pub fn terminate(&self, code: u32) -> Result<(), u32> {
        // SAFETY: the handle is live and carries JOB_OBJECT_TERMINATE (the creator's full-access handle).
        if unsafe { TerminateJobObject(self.0, code) } == 0 {
            Err(last_error())
        } else {
            Ok(())
        }
    }
}
