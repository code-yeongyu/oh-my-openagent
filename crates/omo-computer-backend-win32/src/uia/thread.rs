//! The `uia` thread (d-windows.md '## UI Automation', One client, one thread): `IUIAutomation`
//! is not `Send`, so the client lives on one dedicated thread and the session thread sends it
//! each read over a channel and waits for the answer. The thread ends with the session.

use std::sync::mpsc::{channel, Sender};
use std::thread::JoinHandle;

use omo_computer_core::ax::Slice;
use windows::Win32::Foundation::HWND;

use super::cache::{cache_request, CacheRequest};
use super::com::ComUia;
use super::element::{Toast, UiaElement, UiaError};
use super::source::UiaSource;

type Job = Box<dyn FnOnce(&mut ComUia) + Send>;

/// The session's handle to the `uia` thread.
pub struct UiaThread {
    jobs: Option<Sender<Job>>,
    thread: Option<JoinHandle<()>>,
    started_ms: u64,
}

impl UiaThread {
    /// Starts the thread and creates the client on it.
    ///
    /// # Errors
    /// [`UiaError::Denied`] when the client cannot be created there.
    pub fn start() -> Result<Self, UiaError> {
        let (jobs, inbox) = channel::<Job>();
        let (ready, started) = channel();
        let thread = std::thread::Builder::new()
            .name("uia".to_owned())
            .spawn(move || {
                let mut client = match ComUia::new() {
                    Ok(client) => {
                        let _ = ready.send(Ok(client.now_ms()));
                        client
                    }
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                for job in inbox {
                    job(&mut client);
                }
            })
            .map_err(|_| UiaError::Denied)?;
        let started_ms = started.recv().map_err(|_| UiaError::Denied)??;
        Ok(Self {
            jobs: Some(jobs),
            thread: Some(thread),
            started_ms,
        })
    }

    fn call<R: Send + 'static>(&self, job: impl FnOnce(&mut ComUia) -> R + Send + 'static) -> Option<R> {
        let (reply, answer) = channel();
        self.jobs
            .as_ref()?
            .send(Box::new(move |client| {
                let _ = reply.send(job(client));
            }))
            .ok()?;
        answer.recv().ok()
    }
}

impl Drop for UiaThread {
    fn drop(&mut self) {
        self.jobs = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl UiaSource for UiaThread {
    fn now_ms(&self) -> u64 {
        self.call(|client| client.now_ms()).unwrap_or(self.started_ms)
    }

    fn elevated(&mut self, hwnd: isize) -> Option<bool> {
        Some(crate::capture::integrity::elevated(HWND(hwnd as *mut _)))
    }

    fn root(&mut self, hwnd: isize) -> Result<UiaElement, UiaError> {
        self.call(move |client| client.root(hwnd, &cache_request("")))
            .unwrap_or(Err(UiaError::Gone))
    }

    fn provider_description(&mut self, root: &UiaElement) -> String {
        let root = root.clone();
        self.call(move |client| client.provider_description(&root))
            .unwrap_or_default()
    }

    fn children(&mut self, parent: &UiaElement, request: &CacheRequest, from: u32, _slice_ms: u64) -> Slice<Vec<UiaElement>> {
        let (parent, request) = (parent.clone(), request.clone());
        self.call(move |client| client.children(&parent, &request, from))
            .unwrap_or(Slice::Hung)
    }

    fn refresh(&mut self, element: &UiaElement, _slice_ms: u64) -> Slice<Option<UiaElement>> {
        let element = element.clone();
        self.call(move |client| client.refresh(&element, &cache_request("")))
            .map_or(Slice::Hung, Slice::Read)
    }

    fn find_runtime_id(&mut self, hwnd: isize, runtime_id: &[i32]) -> Vec<UiaElement> {
        let runtime_id = runtime_id.to_vec();
        self.call(move |client| client.find_runtime_id(hwnd, &runtime_id, &cache_request("")))
            .unwrap_or_default()
    }

    fn focused(&self) -> Option<UiaElement> {
        self.call(|client| client.focused(&cache_request(""))).flatten()
    }

    fn toasts(&mut self) -> Option<Vec<Toast>> {
        self.call(|client| client.toasts()).flatten()
    }
}
