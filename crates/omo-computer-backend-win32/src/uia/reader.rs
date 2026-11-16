//! The Windows accessibility reader the bounded walk takes (`AxReader`): every element read
//! through the one client with the walk's cache request, an element's identity its `RuntimeId`,
//! a password field's value never read out (`secure:true`), and an elevated target refused
//! before any walk (d-windows.md '## UI Automation', Permission).

use omo_computer_core::ax::{AxHandle, AxReader, Evidence, NodeRead, RootRead, Slice, WindowKey};
use omo_computer_core::backend::{BackendResult, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use super::cache::{cache_request, CacheRequest};
use super::element::{UiaElement, UiaError};
use super::identity::native_object;
use super::source::UiaSource;

/// `AxUnsupported{elevated_target}`: an elevated target is not read, before any walk.
pub const ELEVATED: Refusal =
    Refusal::new(EngineCode::AxUnsupported, Reason::ElevatedTarget);

/// The reader over one UI Automation client.
pub struct UiaReader<S> {
    source: S,
    elements: Vec<UiaElement>,
    request: Option<CacheRequest>,
}

fn node_read(element: &UiaElement, handle: AxHandle) -> NodeRead {
    let value = if element.is_password {
        None
    } else {
        element.value.clone()
    };
    NodeRead {
        handle: Some(handle),
        object: Some(native_object(&element.runtime_id)),
        role: element.control_type.clone(),
        native_role: element.class_name.clone(),
        title: element.name.clone(),
        evidence: Evidence::of(element.name.is_some(), value.is_some(), false),
        value,
        native_id: element.automation_id.clone(),
        enabled: Some(element.enabled),
        focused: Some(element.has_focus),
        secure: element.is_password,
        bounds: element.bounds,
        child_count: element.child_count,
        ..NodeRead::default()
    }
}

fn refused(error: UiaError) -> Refusal {
    match error {
        UiaError::Gone => Refusal::bare(EngineCode::WindowNotFound),
        UiaError::Denied => Refusal::bare(EngineCode::AxUnsupported),
    }
}

impl<S: UiaSource> UiaReader<S> {
    #[must_use]
    pub const fn new(source: S) -> Self {
        Self {
            source,
            elements: Vec::new(),
            request: None,
        }
    }

    /// The client (tests read what the walk asked for).
    #[must_use]
    pub const fn source(&self) -> &S {
        &self.source
    }

    pub fn source_mut(&mut self) -> &mut S {
        &mut self.source
    }

    fn keep(&mut self, element: UiaElement) -> NodeRead {
        let handle = AxHandle(u64::try_from(self.elements.len()).unwrap_or(u64::MAX));
        let read = node_read(&element, handle);
        self.elements.push(element);
        read
    }

    pub(super) fn element(&self, handle: AxHandle) -> Option<UiaElement> {
        usize::try_from(handle.0)
            .ok()
            .and_then(|index| self.elements.get(index))
            .cloned()
    }

    /// The root of `window` (a decimal `HWND`): refused before any walk when elevated.
    ///
    /// # Errors
    /// [`ELEVATED`]; `WindowNotFound` for a window that is gone or not an `HWND`.
    pub fn root_of(&mut self, window: &str) -> BackendResult<RootRead> {
        let hwnd: isize = window
            .parse()
            .map_err(|_| Refusal::bare(EngineCode::WindowNotFound))?;
        if self.source.elevated(hwnd) == Some(true) {
            return Err(ELEVATED);
        }
        let root = self.source.root(hwnd).map_err(refused)?;
        self.request = Some(cache_request(&self.source.provider_description(&root)));
        let key = WindowKey {
            id: window.to_owned(),
            pid: root.pid,
            process_start: root.process_start,
        };
        let focused = root.has_focus;
        let node = self.keep(root);
        Ok(RootRead {
            window: key,
            app: String::new(),
            focused,
            node,
        })
    }

    /// Children of `parent` from `from`, read with the walk's cache request.
    pub fn read_children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        let Some(element) = self.element(parent) else {
            return Slice::Read(Vec::new());
        };
        let request = self
            .request
            .clone()
            .unwrap_or_else(|| cache_request(""));
        match self.source.children(&element, &request, from, slice_ms) {
            Slice::Read(children) => Slice::Read(children.into_iter().map(|c| self.keep(c)).collect()),
            Slice::Hung => Slice::Hung,
        }
    }

    /// A fresh read of `handle`'s element.
    pub fn read_node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        let Some(element) = self.element(handle) else {
            return Slice::Read(None);
        };
        match self.source.refresh(&element, slice_ms) {
            Slice::Read(fresh) => Slice::Read(fresh.map(|e| node_read(&e, handle))),
            Slice::Hung => Slice::Hung,
        }
    }
}

impl<S: UiaSource> AxReader for UiaReader<S> {
    fn now_ms(&self) -> u64 {
        self.source.now_ms()
    }

    fn root(&mut self, window: &str) -> BackendResult<RootRead> {
        self.root_of(window)
    }

    fn children(&mut self, parent: AxHandle, from: u32, slice_ms: u64) -> Slice<Vec<NodeRead>> {
        self.read_children(parent, from, slice_ms)
    }

    fn node(&mut self, handle: AxHandle, slice_ms: u64) -> Slice<Option<NodeRead>> {
        self.read_node(handle, slice_ms)
    }
}
