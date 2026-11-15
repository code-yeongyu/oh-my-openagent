//! A minimal debugger for fault rows that need the helper stopped at an exact point no external event can reach
//! deterministically (review of #12105, findings 1 and 5). It launches the helper with `DEBUG_ONLY_THIS_PROCESS`,
//! plants one software breakpoint on a kernel32 export once the loader breakpoint has fired, and at the first hit
//! hands the stopped state to the row, restores the original bytes, rewinds the program counter and detaches.
//! System DLLs are mapped at the same base in every process of a boot, so the export address read here is the
//! address the helper calls.
use std::path::Path;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{
    DBG_CONTINUE, DBG_EXCEPTION_NOT_HANDLED, EXCEPTION_BREAKPOINT, HANDLE,
};
use windows_sys::Win32::System::Diagnostics::Debug::{
    ContinueDebugEvent, DebugActiveProcessStop, DebugSetProcessKillOnExit, FlushInstructionCache,
    GetThreadContext, ReadProcessMemory, SetThreadContext, WaitForDebugEvent, WriteProcessMemory,
    CONTEXT, CREATE_PROCESS_DEBUG_EVENT, DEBUG_EVENT, EXCEPTION_DEBUG_EVENT,
    EXIT_PROCESS_DEBUG_EVENT, LOAD_DLL_DEBUG_EVENT,
};
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Threading::{
    OpenThread, DEBUG_ONLY_THIS_PROCESS, THREAD_GET_CONTEXT, THREAD_SET_CONTEXT,
};

use super::win::{last_error, spawn, wide, Owned};

#[cfg(target_arch = "x86_64")]
const BREAK: [u8; 1] = [0xCC];
/// `brk #0xF000`, the Windows debug-break encoding on ARM64.
#[cfg(target_arch = "aarch64")]
const BREAK: [u8; 4] = 0xD43E_0000u32.to_le_bytes();

#[cfg(target_arch = "x86_64")]
const FLAGS: u32 = windows_sys::Win32::System::Diagnostics::Debug::CONTEXT_CONTROL_AMD64
    | windows_sys::Win32::System::Diagnostics::Debug::CONTEXT_INTEGER_AMD64;
#[cfg(target_arch = "aarch64")]
const FLAGS: u32 = windows_sys::Win32::System::Diagnostics::Debug::CONTEXT_CONTROL_ARM64
    | windows_sys::Win32::System::Diagnostics::Debug::CONTEXT_INTEGER_ARM64;

/// GetThreadContext requires a 16-byte aligned CONTEXT on x64.
#[repr(C, align(16))]
struct Aligned(CONTEXT);

/// The helper, stopped on the first instruction of the export.
pub struct Hit<'a> {
    pub process: HANDLE,
    /// The export's first argument (RCX on x64, X0 on ARM64).
    pub first_argument: u64,
    pub op_id: &'a str,
}

fn export_address(export: &str) -> Result<usize, String> {
    let module = wide("kernel32.dll");
    let name = format!("{export}\0");
    // SAFETY: both strings are NUL-terminated; kernel32 is loaded in every process.
    let address = unsafe { GetProcAddress(GetModuleHandleW(module.as_ptr()), name.as_ptr()) };
    address
        .map(|function| function as usize)
        .ok_or_else(|| format!("GetProcAddress({export}) failed {}", last_error()))
}

fn patch(process: HANDLE, at: usize, bytes: &[u8]) -> Result<(), String> {
    let mut written = 0usize;
    let address = std::ptr::without_provenance::<core::ffi::c_void>(at);
    // SAFETY: writes `bytes` into the stopped debuggee's code page (WriteProcessMemory handles the protection) and
    // flushes that range, so the next fetch sees it.
    let ok = unsafe {
        WriteProcessMemory(
            process,
            address,
            bytes.as_ptr().cast(),
            bytes.len(),
            &mut written,
        ) != 0
            && FlushInstructionCache(process, address, bytes.len()) != 0
    };
    if ok && written == bytes.len() {
        Ok(())
    } else {
        Err(format!("patching {at:#x} failed {}", last_error()))
    }
}

fn read_original(process: HANDLE, at: usize) -> Result<[u8; BREAK.len()], String> {
    let mut original = [0u8; BREAK.len()];
    let mut read = 0usize;
    let address = std::ptr::without_provenance::<core::ffi::c_void>(at);
    // SAFETY: reads BREAK.len() bytes of the debuggee's code into a local buffer of that size.
    let ok = unsafe {
        ReadProcessMemory(
            process,
            address,
            original.as_mut_ptr().cast(),
            original.len(),
            &mut read,
        )
    };
    if ok != 0 && read == original.len() {
        Ok(original)
    } else {
        Err(format!("reading {at:#x} failed {}", last_error()))
    }
}

/// Reads the first argument and rewinds the program counter to `at`, so the restored instruction runs next.
fn rewind(thread_id: u32, at: usize) -> Result<u64, String> {
    // SAFETY: opens the stopped debuggee thread that raised the event.
    let thread =
        Owned::new(unsafe { OpenThread(THREAD_GET_CONTEXT | THREAD_SET_CONTEXT, 0, thread_id) })
            .ok_or_else(|| format!("OpenThread failed {}", last_error()))?;
    // SAFETY: CONTEXT is a plain C struct for which all-zero is valid.
    let mut context = Aligned(unsafe { std::mem::zeroed() });
    context.0.ContextFlags = FLAGS;
    // SAFETY: the thread is stopped at a debug event; `context` is aligned and writable.
    if unsafe { GetThreadContext(thread.raw(), &mut context.0) } == 0 {
        return Err(format!("GetThreadContext failed {}", last_error()));
    }
    let at = u64::try_from(at).unwrap_or(0);
    #[cfg(target_arch = "x86_64")]
    let first = {
        context.0.Rip = at;
        context.0.Rcx
    };
    #[cfg(target_arch = "aarch64")]
    // SAFETY: the integer registers were requested, so the union holds X0..X28.
    let first = unsafe {
        context.0.Pc = at;
        context.0.Anonymous.Anonymous.X0
    };
    // SAFETY: as above; only control and integer registers are written back.
    if unsafe { SetThreadContext(thread.raw(), &context.0) } == 0 {
        return Err(format!("SetThreadContext failed {}", last_error()));
    }
    Ok(first)
}

/// Runs `exe args` as a debuggee until its first call into kernel32!`export`, runs `on_hit` there, detaches and
/// returns the still-running process. Any exception other than the two breakpoints is passed back unhandled.
pub fn run_to_first_call(
    exe: &Path,
    args: &[&str],
    export: &str,
    op_id: &str,
    on_hit: impl FnOnce(&Hit<'_>),
) -> Result<(Owned, u32), String> {
    let target = export_address(export)?;
    let (process, pid) = spawn(exe, args, DEBUG_ONLY_THIS_PROCESS)
        .map_err(|error| format!("debug launch failed {error}"))?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut original = None;
    let mut on_hit = Some(on_hit);
    loop {
        let wait = u32::try_from(
            deadline
                .saturating_duration_since(Instant::now())
                .as_millis(),
        )
        .unwrap_or(0);
        // SAFETY: DEBUG_EVENT is a plain C struct for which all-zero is valid.
        let mut event: DEBUG_EVENT = unsafe { std::mem::zeroed() };
        // SAFETY: `event` is writable; this thread created the debuggee.
        if unsafe { WaitForDebugEvent(&mut event, wait) } == 0 {
            return Err(format!("no debug event before {export} within 60 s"));
        }
        let mut status = DBG_CONTINUE;
        let mut hit = false;
        // SAFETY: each arm reads the union member its event code selects.
        match event.dwDebugEventCode {
            CREATE_PROCESS_DEBUG_EVENT => {
                drop(Owned::new(unsafe { event.u.CreateProcessInfo.hFile }))
            }
            LOAD_DLL_DEBUG_EVENT => drop(Owned::new(unsafe { event.u.LoadDll.hFile })),
            EXIT_PROCESS_DEBUG_EVENT => {
                return Err(format!(
                    "the helper exited {} before calling {export}",
                    unsafe { event.u.ExitProcess.dwExitCode }
                ));
            }
            EXCEPTION_DEBUG_EVENT => {
                let record = unsafe { event.u.Exception.ExceptionRecord };
                let at = record.ExceptionAddress.addr();
                if record.ExceptionCode != EXCEPTION_BREAKPOINT {
                    status = DBG_EXCEPTION_NOT_HANDLED;
                } else if original.is_none() {
                    // The loader breakpoint: kernel32 is mapped, so the export can be patched now.
                    original = Some(read_original(process.raw(), target)?);
                    patch(process.raw(), target, &BREAK)?;
                } else if at == target || at == target + 1 {
                    let bytes = original.ok_or("breakpoint hit before it was planted")?;
                    let first_argument = rewind(event.dwThreadId, target)?;
                    patch(process.raw(), target, &bytes)?;
                    if let Some(row) = on_hit.take() {
                        row(&Hit {
                            process: process.raw(),
                            first_argument,
                            op_id,
                        });
                    }
                    hit = true;
                } else {
                    status = DBG_EXCEPTION_NOT_HANDLED;
                }
            }
            _ => {}
        }
        // SAFETY: continues the event this loop just received.
        unsafe { ContinueDebugEvent(event.dwProcessId, event.dwThreadId, status) };
        if hit {
            // SAFETY: plain debugger-state calls for the debuggee this thread owns.
            let detached =
                unsafe { DebugSetProcessKillOnExit(0) != 0 && DebugActiveProcessStop(pid) != 0 };
            return if detached {
                Ok((process, pid))
            } else {
                Err(format!("detach failed {}", last_error()))
            };
        }
    }
}
