use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows_sys::Win32::System::Pipes::{ConnectNamedPipe, GetNamedPipeClientProcessId};
use windows_sys::Win32::System::Threading::{
    CreateEventW, OpenProcess, SetEvent, WaitForMultipleObjects, INFINITE,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult};

use super::pipe::{overlapped_with_event, ServerPipe};
use super::win::{last_error, Owned};

pub struct Accepted {
    pub at: Instant,
    pub pid: u32,
    pub process: Option<Owned>,
}

type Shared = Arc<(Mutex<Vec<Accepted>>, Condvar)>;

/// The test's pipe server for testkit members: every accepted client is timestamped, identified by
/// `GetNamedPipeClientProcessId` and gets a SYNCHRONIZE handle. Accepted instances stay open until `stop`,
/// so a connected blocker never sees EOF while the row is still observing it.
pub struct Observer {
    shared: Shared,
    stop: Owned,
    thread: Option<JoinHandle<Vec<ServerPipe>>>,
}

impl Observer {
    pub fn start(suffix: &str, sddl: Option<&str>) -> Self {
        let shared: Shared = Arc::new((Mutex::new(Vec::new()), Condvar::new()));
        // SAFETY: a manual-reset, unnamed, initially non-signaled event.
        let stop = Owned::new(unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) })
            .expect("event");
        let (suffix, sddl, sink, stop_raw) = (
            suffix.to_owned(),
            sddl.map(str::to_owned),
            Arc::clone(&shared),
            stop.raw() as usize,
        );
        let thread = std::thread::spawn(move || {
            accept_loop(&suffix, sddl.as_deref(), &sink, stop_raw as HANDLE)
        });
        Self {
            shared,
            stop,
            thread: Some(thread),
        }
    }

    /// Waits until at least `count` clients have been accepted.
    pub fn wait_for(&self, count: usize, timeout: Duration) -> bool {
        let (list, ready) = &*self.shared;
        let guard = list.lock().expect("observer lock");
        let (guard, _) = ready
            .wait_timeout_while(guard, timeout, |accepted| accepted.len() < count)
            .expect("observer lock");
        guard.len() >= count
    }

    pub fn with<R>(&self, read: impl FnOnce(&[Accepted]) -> R) -> R {
        read(&self.shared.0.lock().expect("observer lock"))
    }

    /// Stops accepting and closes every instance, so each connected blocker reads EOF and exits.
    pub fn stop(mut self) {
        self.halt();
    }

    fn halt(&mut self) {
        // SAFETY: `stop` is a live event owned by this observer.
        unsafe { SetEvent(self.stop.raw()) };
        if let Some(thread) = self.thread.take() {
            drop(thread.join().expect("observer thread"));
        }
    }
}

impl Drop for Observer {
    fn drop(&mut self) {
        self.halt();
    }
}

fn accept_loop(suffix: &str, sddl: Option<&str>, sink: &Shared, stop: HANDLE) -> Vec<ServerPipe> {
    let mut instances = Vec::new();
    loop {
        let Ok(instance) = ServerPipe::create(suffix, sddl, instances.is_empty()) else {
            return instances;
        };
        let (mut overlapped, _event) = overlapped_with_event();
        // SAFETY: `overlapped` and its event outlive the operation, which is completed or cancelled below.
        let started = unsafe { ConnectNamedPipe(instance.raw(), &mut overlapped) } != 0;
        let connected =
            started || last_error() == windows_sys::Win32::Foundation::ERROR_PIPE_CONNECTED || {
                let waits = [overlapped.hEvent, stop];
                // SAFETY: both handles are live for the wait.
                let woke = unsafe { WaitForMultipleObjects(2, waits.as_ptr(), 0, INFINITE) };
                if woke != WAIT_OBJECT_0 {
                    let mut ignored = 0u32;
                    // SAFETY: cancels and drains this exact operation before `overlapped` goes out of scope.
                    unsafe {
                        CancelIoEx(instance.raw(), &overlapped);
                        GetOverlappedResult(instance.raw(), &overlapped, &mut ignored, 1);
                    }
                }
                woke == WAIT_OBJECT_0
            };
        if !connected {
            return instances;
        }
        let at = Instant::now();
        let mut pid = 0u32;
        // SAFETY: the instance is connected; `pid` is a writable u32.
        unsafe { GetNamedPipeClientProcessId(instance.raw(), &mut pid) };
        let access = PROCESS_SYNCHRONIZE | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION;
        // SAFETY: plain open by pid; the result is checked by `Owned::new`.
        let process = Owned::new(unsafe { OpenProcess(access, 0, pid) });
        instances.push(instance);
        let (list, ready) = &**sink;
        list.lock()
            .expect("observer lock")
            .push(Accepted { at, pid, process });
        ready.notify_all();
    }
}
