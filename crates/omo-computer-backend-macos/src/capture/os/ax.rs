//! The AX side of the listing: a window's minimized, focused and title facts, matched to its
//! window number through the private `_AXUIElementGetWindow` when it resolves, else by frame.

use std::ffi::{c_void, CStr};

use super::cf::{self, cf_string, CfRef, CgPoint, CgSize, Owned};
use super::symbols;
use crate::capture::types::{AxWindowFacts, CgWindow};

const AX_SUCCESS: i32 = 0;
const VALUE_CGPOINT: u32 = 1;
const VALUE_CGSIZE: u32 = 2;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CfRef;
    fn AXUIElementCopyAttributeValue(element: CfRef, attribute: CfRef, value: *mut CfRef) -> i32;
    fn AXValueGetValue(value: CfRef, kind: u32, out: *mut c_void) -> bool;
}

type GetWindow = unsafe extern "C" fn(CfRef, *mut u32) -> i32;

fn attribute(element: CfRef, name: &CStr) -> Option<Owned> {
    let key = cf_string(name)?;
    let mut value: CfRef = std::ptr::null();
    // SAFETY: `element` is an AXUIElement, `key` a CFString; a success returns a +1 value.
    let status = unsafe { AXUIElementCopyAttributeValue(element, key.get(), &raw mut value) };
    if status == AX_SUCCESS { Owned::new(value) } else { None }
}

fn frame_matches(element: CfRef, window: &CgWindow) -> bool {
    let mut point = CgPoint::default();
    let mut size = CgSize::default();
    let read = |name: &CStr, kind: u32, out: *mut c_void| {
        // SAFETY: `out` matches `kind`'s layout.
        attribute(element, name).is_some_and(|v| unsafe { AXValueGetValue(v.get(), kind, out) })
    };
    read(c"AXPosition", VALUE_CGPOINT, (&raw mut point).cast())
        && read(c"AXSize", VALUE_CGSIZE, (&raw mut size).cast())
        && (point.x - window.bounds.x).abs() < 1.0
        && (point.y - window.bounds.y).abs() < 1.0
        && (size.width - window.bounds.width).abs() < 1.0
        && (size.height - window.bounds.height).abs() < 1.0
}

fn same_window(element: CfRef, window: &CgWindow) -> bool {
    if let Some(get) = symbols::lookup::<GetWindow>(c"_AXUIElementGetWindow") {
        let mut number = 0u32;
        // SAFETY: the resolved symbol has this signature (macos-spi.tsv names it).
        if unsafe { get(element, &raw mut number) } == AX_SUCCESS {
            return number == window.number;
        }
    }
    frame_matches(element, window)
}

/// The facts of `window`; `None` without the Accessibility grant or without a match.
pub fn facts(window: &CgWindow) -> Option<AxWindowFacts> {
    let pid = i32::try_from(window.pid).ok()?;
    // SAFETY: plain call; the result is a +1 AXUIElement.
    let app = Owned::new(unsafe { AXUIElementCreateApplication(pid) })?;
    let windows = attribute(app.get(), c"AXWindows")?;
    let focused = attribute(app.get(), c"AXFocusedWindow");
    // SAFETY: `windows` is a CFArray of AXUIElements.
    let count = unsafe { cf::CFArrayGetCount(windows.get()) };
    (0..count).find_map(|index| {
        // SAFETY: `index` is in bounds; the element is owned by the array.
        let element = unsafe { cf::CFArrayGetValueAtIndex(windows.get(), index) };
        same_window(element, window).then(|| AxWindowFacts {
            minimized: attribute(element, c"AXMinimized").is_some_and(|v| cf::boolean(v.get())),
            // SAFETY: both are AXUIElements; AX hands out distinct references to one window.
            focused: focused.as_ref().is_some_and(|f| unsafe { cf::CFEqual(f.get(), element) }),
            title: attribute(element, c"AXTitle").and_then(|v| cf::string(v.get())),
        })
    })
}
