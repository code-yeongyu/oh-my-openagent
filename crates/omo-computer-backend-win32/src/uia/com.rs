//! The live UI Automation client (d-windows.md '## UI Automation', One client, one thread):
//! `CUIAutomation8` created once on the `uia` thread (an MTA), one cache request per walk built
//! from [`super::cache::PROPERTIES`], elements kept by `RuntimeId` between calls so a later read
//! starts from the same COM object. Only [`super::thread`] talks to it.

use std::collections::HashMap;
use std::time::Instant;

use omo_computer_core::ax::Slice;
use omo_computer_core::listing::Rect;
use windows::core::BSTR;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
};
use windows::Win32::System::Variant::{VariantClear, VARIANT, VT_BSTR};
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};
use windows::Win32::UI::Accessibility::{
    AutomationElementMode_Full, CUIAutomation8, IUIAutomation, IUIAutomationCacheRequest,
    IUIAutomationElement, TreeScope_Children, TreeScope_Element,
    UIA_AutomationIdPropertyId,
    UIA_BoundingRectanglePropertyId, UIA_ClassNamePropertyId, UIA_ControlTypePropertyId,
    UIA_HasKeyboardFocusPropertyId, UIA_IsEnabledPropertyId, UIA_IsPasswordPropertyId,
    UIA_NamePropertyId, UIA_NativeWindowHandlePropertyId, UIA_ProcessIdPropertyId,
    UIA_ProviderDescriptionPropertyId, UIA_RuntimeIdPropertyId, UIA_ValueValuePropertyId,
    UIA_PROPERTY_ID,
};

use super::cache::{Batching, CacheRequest};
use super::control_type::name_of;
use super::element::{Toast, UiaElement, UiaError};
use runtime_id::runtime_id;

mod runtime_id;

const CACHED: [UIA_PROPERTY_ID; 12] = [
    UIA_NamePropertyId,
    UIA_ControlTypePropertyId,
    UIA_AutomationIdPropertyId,
    UIA_ClassNamePropertyId,
    UIA_BoundingRectanglePropertyId,
    UIA_IsEnabledPropertyId,
    UIA_HasKeyboardFocusPropertyId,
    UIA_IsPasswordPropertyId,
    UIA_NativeWindowHandlePropertyId,
    UIA_ProcessIdPropertyId,
    UIA_RuntimeIdPropertyId,
    UIA_ValueValuePropertyId,
];

pub struct ComUia {
    automation: IUIAutomation,
    kept: HashMap<Vec<i32>, IUIAutomationElement>,
    started: Instant,
}

fn text(value: windows::core::Result<BSTR>) -> Option<String> {
    value.ok().map(|bstr| bstr.to_string()).filter(|s| !s.is_empty())
}

/// The text a property VARIANT holds, cleared after the read; `None` for any other type.
fn variant_text(mut value: VARIANT) -> Option<String> {
    // SAFETY: the bstrVal arm is read only when the type tag says VT_BSTR, and the VARIANT is
    // cleared exactly once afterwards, freeing what it owns.
    unsafe {
        let inner = &value.Anonymous.Anonymous;
        let text = (inner.vt == VT_BSTR).then(|| inner.Anonymous.bstrVal.to_string());
        let _ = VariantClear(&mut value);
        text.filter(|s| !s.is_empty())
    }
}

fn cached_string(element: &IUIAutomationElement, property: UIA_PROPERTY_ID) -> Option<String> {
    // SAFETY: a cached read of a property the cache request carries.
    variant_text(unsafe { element.GetCachedPropertyValue(property) }.ok()?)
}

/// The top-level window `hwnd` lives in (`GetAncestor(GA_ROOT)`); 0 for no window.
fn top_level_of(hwnd: isize) -> isize {
    if hwnd == 0 {
        return 0;
    }
    // SAFETY: a window handle read from UIA; a stale one answers a null HWND.
    unsafe { GetAncestor(HWND(hwnd as *mut _), GA_ROOT) }.0 as isize
}

fn read(element: &IUIAutomationElement) -> UiaElement {
    // SAFETY: every Cached* getter reads a property the cache request carries.
    unsafe {
        let rect = element.CachedBoundingRectangle().ok();
        let is_password = element.CachedIsPassword().is_ok_and(|b| b.as_bool());
        let hwnd = element.CachedNativeWindowHandle().map_or(0, |h| h.0 as isize);
        UiaElement {
            runtime_id: runtime_id(element),
            control_type: name_of(element.CachedControlType().map_or(0, |id| id.0)).to_owned(),
            name: text(element.CachedName()),
            automation_id: text(element.CachedAutomationId()),
            class_name: text(element.CachedClassName()),
            value: if is_password { None } else { cached_string(element, UIA_ValueValuePropertyId) },
            is_password,
            has_focus: element.CachedHasKeyboardFocus().is_ok_and(|b| b.as_bool()),
            enabled: element.CachedIsEnabled().is_ok_and(|b| b.as_bool()),
            bounds: rect.map(|r| Rect {
                x: f64::from(r.left),
                y: f64::from(r.top),
                width: f64::from(r.right - r.left),
                height: f64::from(r.bottom - r.top),
            }),
            hwnd,
            top_level: top_level_of(hwnd),
            pid: element.CachedProcessId().map_or(0, |pid| u32::try_from(pid).unwrap_or(0)),
            process_start: 0,
            child_count: 0,
        }
    }
}

impl ComUia {
    /// `CoCreateInstance(CLSID_CUIAutomation8)` on the calling (the `uia`) thread, in an MTA.
    ///
    /// # Errors
    /// [`UiaError::Denied`] when COM or the client cannot start.
    pub fn new() -> Result<Self, UiaError> {
        // SAFETY: initialises COM for this thread, which owns the client for its whole life.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        // SAFETY: an in-process class object of the UIA core.
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER) }
                .map_err(|_| UiaError::Denied)?;
        Ok(Self {
            automation,
            kept: HashMap::new(),
            started: Instant::now(),
        })
    }

    pub fn now_ms(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    fn cache(&self, request: &CacheRequest, scope_element: bool) -> Option<IUIAutomationCacheRequest> {
        // SAFETY: builds a request object owned by this thread.
        unsafe {
            let cache = self.automation.CreateCacheRequest().ok()?;
            for property in CACHED {
                cache.AddProperty(property).ok()?;
            }
            if scope_element {
                cache.SetTreeScope(TreeScope_Element).ok()?;
            }
            if request.batching == Batching::Batch {
                cache.SetAutomationElementMode(AutomationElementMode_Full).ok()?;
            }
            Some(cache)
        }
    }

    fn keep(&mut self, element: IUIAutomationElement) -> UiaElement {
        let read = read(&element);
        self.kept.insert(read.runtime_id.clone(), element);
        read
    }

    /// The root element of `hwnd`, read through a cache request.
    ///
    /// # Errors
    /// [`UiaError::Gone`] when the window has no element.
    pub fn root(&mut self, hwnd: isize, request: &CacheRequest) -> Result<UiaElement, UiaError> {
        self.kept.clear();
        let cache = self.cache(request, true).ok_or(UiaError::Denied)?;
        // SAFETY: a window handle the caller named; UIA validates it.
        let element = unsafe {
            self.automation
                .ElementFromHandleBuildCache(HWND(hwnd as *mut _), &cache)
        }
        .map_err(|_| UiaError::Gone)?;
        Ok(self.keep(element))
    }

    pub fn provider_description(&self, root: &UiaElement) -> String {
        let Some(element) = self.kept.get(&root.runtime_id) else {
            return String::new();
        };
        // SAFETY: a current read on a live element.
        unsafe { element.GetCurrentPropertyValue(UIA_ProviderDescriptionPropertyId) }
            .ok()
            .and_then(variant_text)
            .unwrap_or_default()
    }

    /// Children of `parent` from `from` on, read in one batched call.
    pub fn children(&mut self, parent: &UiaElement, request: &CacheRequest, from: u32) -> Slice<Vec<UiaElement>> {
        let Some(element) = self.kept.get(&parent.runtime_id).cloned() else {
            return Slice::Read(Vec::new());
        };
        let Some(cache) = self.cache(request, false) else {
            return Slice::Hung;
        };
        // SAFETY: a true condition and a cache request owned by this thread.
        let found = unsafe {
            self.automation
                .CreateTrueCondition()
                .and_then(|condition| element.FindAllBuildCache(TreeScope_Children, &condition, &cache))
        };
        let Ok(found) = found else {
            return Slice::Hung;
        };
        // SAFETY: indices below Length().
        let length = unsafe { found.Length() }.unwrap_or(0);
        let start = i32::try_from(from).unwrap_or(i32::MAX);
        let children = (start..length)
            .filter_map(|index| unsafe { found.GetElement(index) }.ok())
            .map(|child| self.keep(child))
            .collect();
        Slice::Read(children)
    }

    pub fn refresh(&mut self, element: &UiaElement, request: &CacheRequest) -> Option<UiaElement> {
        let live = self.kept.get(&element.runtime_id)?.clone();
        let cache = self.cache(request, true)?;
        // SAFETY: a live element and a cache request owned by this thread.
        let fresh = unsafe { live.BuildUpdatedCache(&cache) }.ok()?;
        Some(self.keep(fresh))
    }

    pub fn focused(&self, request: &CacheRequest) -> Option<UiaElement> {
        let cache = self.cache(request, true)?;
        // SAFETY: a cache request owned by this thread.
        let element = unsafe { self.automation.GetFocusedElementBuildCache(&cache) }.ok()?;
        let mut focused = read(&element);
        if focused.top_level == 0 {
            focused.top_level = self.window_of_windowless(&element);
        }
        Some(focused)
    }

    /// The top-level window of an element without its own `HWND` (WPF, WinUI, web content): the
    /// nearest ancestor that has one, at most 64 steps up.
    fn window_of_windowless(&self, element: &IUIAutomationElement) -> isize {
        // SAFETY: tree walks on live elements owned by this thread.
        unsafe {
            let Ok(walker) = self.automation.RawViewWalker() else {
                return 0;
            };
            let mut current = element.clone();
            for _ in 0..64 {
                let Ok(parent) = walker.GetParentElement(&current) else {
                    return 0;
                };
                let hwnd = parent.CurrentNativeWindowHandle().map_or(0, |h| h.0 as isize);
                if hwnd != 0 {
                    return top_level_of(hwnd);
                }
                current = parent;
            }
            0
        }
    }

    /// The live client reads no toast list until row 60 lists `ShellExperienceHost.exe`'s windows.
    pub const fn toasts(&self) -> Option<Vec<Toast>> {
        None
    }
}
