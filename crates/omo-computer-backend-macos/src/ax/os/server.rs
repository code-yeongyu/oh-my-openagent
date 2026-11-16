//! [`AxServer`] over `AXUIElement`.

use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::time::{Duration, Instant};

use omo_computer_core::ax::Slice;

use super::ffi;
use super::observer::{window_of, ObserverThread};
use super::process_query;
use super::token::TokenSymbols;
use super::values::{attributes, read_set, strings, value};
use crate::ax::seam::{
    Attributes, AxServer, AxStatus, AxValue, Element, Notified, RemoteToken, WindowOwner,
};
use crate::ax::table::ElementTable;
use crate::capture::os::cf::{self, cf_string, CfRef, Owned};
use crate::capture::os::{listing, process};

/// The live AX server of one session.
pub struct Server {
    start: Instant,
    elements: ElementTable<Owned>,
    observer: Option<ObserverThread>,
    read_set: Option<Owned>,
    bundles: BTreeMap<String, u32>,
    pub(super) token: Option<TokenSymbols>,
}

// SAFETY: CoreFoundation reference counting is thread-safe and AX calls may be made from any
// thread; the server is used by one thread at a time (`&mut self`).
unsafe impl Send for Server {}

pub(super) const fn status(code: i32) -> AxStatus {
    match code {
        ffi::AX_SUCCESS => AxStatus::Done,
        ffi::AX_ACTION_UNSUPPORTED | ffi::AX_ATTRIBUTE_UNSUPPORTED => AxStatus::Unsupported,
        ffi::AX_INVALID_ELEMENT => AxStatus::Gone,
        _ => AxStatus::Failed,
    }
}

impl Server {
    #[must_use]
    pub fn open() -> Self {
        Self {
            start: Instant::now(),
            elements: ElementTable::default(),
            observer: ObserverThread::start(),
            read_set: read_set(),
            bundles: BTreeMap::new(),
            token: TokenSymbols::probe(),
        }
    }

    /// The id of the element `owned` refers to: the same element keeps one id across reads.
    pub(super) fn insert(&mut self, owned: Owned) -> Element {
        // SAFETY: `owned` is a live CF reference.
        let hash = u64::try_from(unsafe { ffi::CFHash(owned.get()) }).unwrap_or_default();
        // SAFETY: both are live CF references.
        self.elements
            .intern(owned, hash, |a, b| unsafe { cf::CFEqual(a.get(), b.get()) })
    }

    pub(super) fn get(&self, element: Element) -> Option<CfRef> {
        self.elements.get(element).map(Owned::get)
    }

    fn copy(&self, element: CfRef, name: &CStr) -> Option<Owned> {
        let key = cf_string(name)?;
        let mut out: CfRef = std::ptr::null();
        // SAFETY: valid element and key; a success returns a +1 value.
        let code = unsafe { ffi::AXUIElementCopyAttributeValue(element, key.get(), &raw mut out) };
        if code == ffi::AX_SUCCESS {
            Owned::new(out)
        } else {
            None
        }
    }

    fn app_element(pid: u32) -> Option<Owned> {
        // SAFETY: plain call; +1 element.
        Owned::new(unsafe { ffi::AXUIElementCreateApplication(i32::try_from(pid).ok()?) })
    }

    fn elements_of(&mut self, array: &Owned) -> Vec<Element> {
        // SAFETY: `array` is a CFArray of AXUIElements.
        let count = unsafe { cf::CFArrayGetCount(array.get()) };
        (0..count)
            .filter_map(|i| {
                // SAFETY: in bounds; retained for the table.
                Owned::new(unsafe { ffi::CFRetain(cf::CFArrayGetValueAtIndex(array.get(), i)) })
            })
            .map(|owned| self.insert(owned))
            .collect()
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
fn seconds(ms: u64) -> f32 {
    (ms as f32 / 1_000.0).max(0.001)
}

impl AxServer for Server {
    fn now_ms(&self) -> u64 {
        u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn window_owner(&mut self, number: u32) -> Option<WindowOwner> {
        let window = listing::windows()?
            .into_iter()
            .find(|w| w.number == number)?;
        Some(WindowOwner {
            pid: window.pid,
            process_start: process::start(window.pid)?,
            app: window.owner,
            bundle: process::bundle_id(window.pid),
        })
    }

    fn window(&mut self, pid: u32, number: u32) -> Option<Element> {
        let app = Self::app_element(pid)?;
        let windows = self.copy(app.get(), c"AXWindows")?;
        self.elements_of(&windows)
            .into_iter()
            .find(|e| self.get(*e).and_then(window_of) == Some(number))
    }

    fn app(&mut self, pid: u32) -> Option<Element> {
        let app = Self::app_element(pid)?;
        Some(self.insert(app))
    }

    fn menu_bar(&mut self, pid: u32) -> Option<Element> {
        let app = Self::app_element(pid)?;
        let bar = self.copy(app.get(), c"AXMenuBar")?;
        Some(self.insert(bar))
    }

    fn read(&mut self, element: Element, slice_ms: u64) -> Slice<Option<Attributes>> {
        let (Some(raw), Some(names)) = (self.get(element), self.read_set.as_ref()) else {
            return Slice::Read(None);
        };
        let mut values: CfRef = std::ptr::null();
        // SAFETY: valid element and name array; ONE IPC returning a +1 CFArray on success.
        let code = unsafe {
            ffi::AXUIElementSetMessagingTimeout(raw, seconds(slice_ms));
            ffi::AXUIElementCopyMultipleAttributeValues(raw, names.get(), 0, &raw mut values)
        };
        match (code, Owned::new(values)) {
            (ffi::AX_SUCCESS, Some(values)) => Slice::Read(attributes(values.get())),
            (ffi::AX_CANNOT_COMPLETE, _) => Slice::Hung,
            _ => Slice::Read(None),
        }
    }

    fn actions(&mut self, element: Element, slice_ms: u64) -> Slice<Vec<String>> {
        let Some(raw) = self.get(element) else {
            return Slice::Read(Vec::new());
        };
        let mut names: CfRef = std::ptr::null();
        // SAFETY: a valid element; a success returns a +1 CFArray of CFStrings.
        let code = unsafe {
            ffi::AXUIElementSetMessagingTimeout(raw, seconds(slice_ms));
            ffi::AXUIElementCopyActionNames(raw, &raw mut names)
        };
        match (code, Owned::new(names)) {
            (ffi::AX_SUCCESS, Some(names)) => Slice::Read(strings(names.get())),
            (ffi::AX_CANNOT_COMPLETE, _) => Slice::Hung,
            _ => Slice::Read(Vec::new()),
        }
    }

    fn children(
        &mut self,
        element: Element,
        from: u32,
        count: u32,
        slice_ms: u64,
    ) -> Slice<Vec<Element>> {
        let (Some(raw), Some(key)) = (self.get(element), cf_string(c"AXChildren")) else {
            return Slice::Read(Vec::new());
        };
        let mut values: CfRef = std::ptr::null();
        // SAFETY: valid element and key; a success returns a +1 CFArray.
        let code = unsafe {
            ffi::AXUIElementSetMessagingTimeout(raw, seconds(slice_ms));
            ffi::AXUIElementCopyAttributeValues(
                raw,
                key.get(),
                from as isize,
                count as isize,
                &raw mut values,
            )
        };
        match (code, Owned::new(values)) {
            (ffi::AX_SUCCESS, Some(values)) => Slice::Read(self.elements_of(&values)),
            (ffi::AX_CANNOT_COMPLETE, _) => Slice::Hung,
            _ => Slice::Read(Vec::new()),
        }
    }

    fn poke_role(&mut self, app: Element) {
        if let Some(raw) = self.get(app) {
            drop(self.copy(raw, c"AXRole"));
        }
    }

    fn observe(&mut self, pid: u32) -> bool {
        self.observer.as_ref().is_some_and(|o| o.observe(pid))
    }

    fn wait_notification(&mut self, until_ms: u64) -> Option<Notified> {
        let wait = Duration::from_millis(until_ms.saturating_sub(self.now_ms()));
        let raw = self.observer.as_ref()?.events.recv_timeout(wait).ok()?;
        let element = self.insert(Owned::new(raw.element.0)?);
        if raw.notification == "AXUIElementDestroyed" {
            // The element is gone: release it; a ref to it now reads as gone.
            drop(self.elements.remove(element));
        }
        Some(Notified {
            notification: raw.notification,
            pid: raw.pid,
            element,
            window: raw.window,
        })
    }

    fn perform(&mut self, element: Element, action: &str) -> AxStatus {
        let (Some(raw), Some(name)) = (
            self.get(element),
            CString::new(action).ok().and_then(|a| cf_string(&a)),
        ) else {
            return AxStatus::Gone;
        };
        // SAFETY: valid element and action name.
        status(unsafe { ffi::AXUIElementPerformAction(raw, name.get()) })
    }

    fn set(&mut self, element: Element, attribute: &str, to: AxValue) -> AxStatus {
        let raw = self.get(element);
        let name = CString::new(attribute).ok().and_then(|a| cf_string(&a));
        let (Some(raw), Some(name), Some(to)) = (raw, name, value(&to)) else {
            return AxStatus::Failed;
        };
        // SAFETY: valid element, name and value.
        status(unsafe { ffi::AXUIElementSetAttributeValue(raw, name.get(), to.get()) })
    }

    fn process_of_bundle(&mut self, bundle: &str) -> Option<u32> {
        if let Some(pid) = self
            .bundles
            .get(bundle)
            .copied()
            .filter(|p| process::start(*p).is_some())
        {
            return Some(pid);
        }
        let pid = process_query::pid_of_bundle(bundle)?;
        self.bundles.insert(bundle.to_owned(), pid);
        Some(pid)
    }

    fn is_electron(&mut self, pid: u32) -> bool {
        process_query::is_electron(pid)
    }

    fn remote_token(&mut self) -> Option<&mut dyn RemoteToken> {
        if self.token.is_some() {
            Some(self)
        } else {
            None
        }
    }
}
