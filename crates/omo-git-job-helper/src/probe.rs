//! `probe` mode, the reclaimer's oracle (design v4.2 sections 1 and 6.2). Every classification is made from the
//! error code read in the same frame as the call that produced it.
use std::io::{Read, Write};
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{
    ERROR_FILE_NOT_FOUND, ERROR_INVALID_PARAMETER, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, GetDriveTypeW, GetFinalPathNameByHandleW, GetVolumePathNameW,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    OPEN_EXISTING, VOLUME_NAME_DOS,
};
use windows_sys::Win32::System::JobObjects::OpenJobObjectW;
use windows_sys::Win32::System::SystemServices::JOB_OBJECT_QUERY;
use windows_sys::Win32::System::Threading::{
    OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use windows_sys::Win32::System::WindowsProgramming::DRIVE_FIXED;

use crate::cli::{Exit, OpId};
use crate::probe_lines::{self, Line};
use crate::win::{creation_time, last_error, wide, Owned};

enum Helper {
    Alive,
    Dead(&'static str),
    Unknown(u32),
}

enum Job {
    Gone,
    Active(u32),
    Unknown(u32),
}

fn helper(pid: u32, created: u64) -> Helper {
    // SAFETY: plain open by pid; the error is read immediately below.
    let raw = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid,
        )
    };
    let error = last_error();
    let Some(process) = Owned::new(raw) else {
        return if error == ERROR_INVALID_PARAMETER {
            Helper::Dead("no-such-process")
        } else {
            Helper::Unknown(error)
        };
    };
    match creation_time(process.raw()) {
        Err(error) => Helper::Unknown(error),
        Ok(actual) if actual != created => Helper::Dead("pid-reused"),
        // SAFETY: a zero-timeout wait on a live handle.
        Ok(_) => match unsafe { WaitForSingleObject(process.raw(), 0) } {
            WAIT_OBJECT_0 => Helper::Dead("exited"),
            WAIT_TIMEOUT => Helper::Alive,
            _ => Helper::Unknown(last_error()),
        },
    }
}

/// Opens F, reads its active count and closes the handle in the same frame (section 4: microseconds, under the gate).
fn job(op: &OpId) -> Job {
    let name = wide(&op.job_name());
    // SAFETY: `name` is NUL-terminated; the error is read immediately below.
    let raw = unsafe { OpenJobObjectW(JOB_OBJECT_QUERY, 0, name.as_ptr()) };
    let error = last_error();
    let Some(handle) = Owned::new(raw) else {
        return if error == ERROR_FILE_NOT_FOUND {
            Job::Gone
        } else {
            Job::Unknown(error)
        };
    };
    let floor = crate::job::FloorJob::from_query_handle(handle);
    floor.active().map_or_else(Job::Unknown, Job::Active)
}

/// The decision rule of section 1, as one output line.
fn entry_line(index: usize, pid: u32, created: u64, op: &OpId) -> String {
    let (helper_text, job_text, verdict) = match helper(pid, created) {
        Helper::Alive => ("alive".to_owned(), "skipped".to_owned(), "busy"),
        Helper::Unknown(error) => (format!("unknown:{error}"), "skipped".to_owned(), "unknown"),
        Helper::Dead(reason) => match job(op) {
            Job::Gone => (format!("dead:{reason}"), "gone".to_owned(), "reclaimable"),
            Job::Active(0) => (
                format!("dead:{reason}"),
                "active:0".to_owned(),
                "reclaimable",
            ),
            Job::Active(count) => (format!("dead:{reason}"), format!("active:{count}"), "busy"),
            Job::Unknown(error) => (
                format!("dead:{reason}"),
                format!("unknown:{error}"),
                "unknown",
            ),
        },
    };
    format!("entry {index} helper={helper_text} job={job_text} verdict={verdict}")
}

/// Whether the gate file sits on a local fixed volume (the `vouches` input, section 8).
fn volume_line(gate: Option<&str>) -> String {
    let Some(gate) = gate else {
        return "volume none".to_owned();
    };
    let path = wide(gate);
    let share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
    // SAFETY: `path` is NUL-terminated; no access rights are requested, only a handle to resolve the path.
    let raw = unsafe {
        CreateFileW(
            path.as_ptr(),
            0,
            share,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        )
    };
    let Some(file) = Owned::new(raw) else {
        return format!("volume unknown:{}", last_error());
    };
    let mut final_path = vec![0u16; 1024];
    // SAFETY: `final_path` is writable for 1024 units.
    let length = unsafe {
        GetFinalPathNameByHandleW(file.raw(), final_path.as_mut_ptr(), 1024, VOLUME_NAME_DOS)
    };
    let Some(resolved) = usize::try_from(length)
        .ok()
        .filter(|&used| used > 0 && used < 1024)
    else {
        return format!("volume unknown:{}", last_error());
    };
    let resolved = String::from_utf16_lossy(&final_path[..resolved]);
    if resolved.starts_with(r"\\?\UNC\") {
        return "volume other:unc".to_owned();
    }
    let local = wide(resolved.trim_start_matches(r"\\?\"));
    let mut root = vec![0u16; 1024];
    // SAFETY: `local` is NUL-terminated and `root` is writable for 1024 units.
    if unsafe { GetVolumePathNameW(local.as_ptr(), root.as_mut_ptr(), 1024) } == 0 {
        return format!("volume unknown:{}", last_error());
    }
    // SAFETY: `root` now holds a NUL-terminated volume root.
    match unsafe { GetDriveTypeW(root.as_ptr()) } {
        DRIVE_FIXED => "volume fixed".to_owned(),
        other => format!("volume other:{other}"),
    }
}

pub fn probe() -> Exit {
    let mut input = String::new();
    if std::io::stdin().read_to_string(&mut input).is_err() {
        return Exit::Usage;
    }
    let mut lines = Vec::new();
    let mut gate = None;
    for line in input.lines().filter_map(probe_lines::parse) {
        match line {
            Line::Gate(path) => gate = Some(path),
            Line::Entry { pid, created, op } => {
                lines.push(entry_line(lines.len(), pid, created, &op))
            }
            Line::Malformed => {
                lines.push(format!("entry {} malformed verdict=unknown", lines.len()))
            }
        }
    }
    lines.push(volume_line(gate.as_deref()));
    let mut out = std::io::stdout().lock();
    let written = lines
        .iter()
        .try_for_each(|line| writeln!(out, "{line}"))
        .and_then(|()| out.flush());
    if written.is_ok() {
        Exit::Ok
    } else {
        Exit::Pipe
    }
}
