//! The macOS window seam over `AXUIElement`: the window's AX element found by its number
//! (private `_AXUIElementGetWindow`, probed), `AXPosition` / `AXSize` / `AXMinimized` /
//! `AXFullScreen`, and the app's AX windows.

use std::ffi::{c_void, CStr};

use omo_computer_core::listing::Rect;

use super::seam::{FoundWindow, WindowOs};
use crate::capture::os::cf::{self, cf_string, CfRef, CgPoint, CgSize, Owned};
use crate::capture::os::{listing, symbols};

const AX_SUCCESS: i32 = 0;
const VALUE_CGPOINT: u32 = 1;
const VALUE_CGSIZE: u32 = 2;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> CfRef;
    fn AXUIElementCopyAttributeValue(element: CfRef, attribute: CfRef, value: *mut CfRef) -> i32;
    fn AXUIElementSetAttributeValue(element: CfRef, attribute: CfRef, value: CfRef) -> i32;
    fn AXUIElementIsAttributeSettable(element: CfRef, attribute: CfRef, settable: *mut bool)
        -> i32;
    fn AXValueGetValue(value: CfRef, kind: u32, out: *mut c_void) -> bool;
    fn AXValueCreate(kind: u32, value: *const c_void) -> CfRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFBooleanTrue: CfRef;
    static kCFBooleanFalse: CfRef;
    fn CFRetain(value: CfRef) -> CfRef;
}

type GetWindow = unsafe extern "C" fn(CfRef, *mut u32) -> i32;

/// The live window seam.
#[derive(Debug, Default)]
pub struct Os;

fn copy(element: CfRef, name: &CStr) -> Option<Owned> {
    let key = cf_string(name)?;
    let mut out: CfRef = std::ptr::null();
    // SAFETY: valid element and key; a success returns a +1 value.
    (unsafe { AXUIElementCopyAttributeValue(element, key.get(), &raw mut out) } == AX_SUCCESS)
        .then(|| Owned::new(out))
        .flatten()
}

fn set(element: CfRef, name: &CStr, value: CfRef) -> bool {
    // SAFETY: valid element, key and value.
    cf_string(name).is_some_and(
        |key| unsafe { AXUIElementSetAttributeValue(element, key.get(), value) } == AX_SUCCESS,
    )
}

fn number_of(element: CfRef) -> Option<u32> {
    let get = symbols::lookup::<GetWindow>(c"_AXUIElementGetWindow")?;
    let mut number = 0u32;
    // SAFETY: the probed symbol's signature.
    (unsafe { get(element, &raw mut number) } == AX_SUCCESS).then_some(number)
}

fn windows_of(pid: u32) -> Vec<Owned> {
    // SAFETY: plain call; +1 application element.
    let Some(app) = i32::try_from(pid)
        .ok()
        .and_then(|p| Owned::new(unsafe { AXUIElementCreateApplication(p) }))
    else {
        return Vec::new();
    };
    let Some(list) = copy(app.get(), c"AXWindows") else {
        return Vec::new();
    };
    // SAFETY: a CFArray of AXUIElements; each element retained by `copy`'s caller below.
    let count = unsafe { cf::CFArrayGetCount(list.get()) };
    (0..count)
        .filter_map(|i| {
            // SAFETY: in bounds; retained for the returned guard.
            let element = unsafe { cf::CFArrayGetValueAtIndex(list.get(), i) };
            Owned::new(unsafe { CFRetain(element) })
        })
        .collect()
}

fn element(window: u32) -> Option<Owned> {
    let pid = listing::windows()?
        .into_iter()
        .find(|w| w.number == window)?
        .pid;
    windows_of(pid)
        .into_iter()
        .find(|e| number_of(e.get()) == Some(window))
}

fn frame_of(element: CfRef) -> Option<Rect> {
    let mut point = CgPoint::default();
    let mut size = CgSize::default();
    // SAFETY: `point`/`size` match the kinds.
    let p = copy(element, c"AXPosition").is_some_and(|v| unsafe {
        AXValueGetValue(v.get(), VALUE_CGPOINT, (&raw mut point).cast())
    });
    // SAFETY: as above.
    let s = copy(element, c"AXSize")
        .is_some_and(|v| unsafe { AXValueGetValue(v.get(), VALUE_CGSIZE, (&raw mut size).cast()) });
    (p && s).then_some(Rect {
        x: point.x,
        y: point.y,
        width: size.width,
        height: size.height,
    })
}

fn boolean(on: bool) -> CfRef {
    // SAFETY: process-lifetime constants.
    unsafe {
        if on {
            kCFBooleanTrue
        } else {
            kCFBooleanFalse
        }
    }
}

impl WindowOs for Os {
    fn frame(&mut self, window: u32) -> Option<Rect> {
        frame_of(element(window)?.get())
    }

    fn position_settable(&mut self, window: u32) -> Option<bool> {
        let element = element(window)?;
        let key = cf_string(c"AXPosition")?;
        let mut settable = false;
        // SAFETY: valid element and key.
        (unsafe { AXUIElementIsAttributeSettable(element.get(), key.get(), &raw mut settable) }
            == AX_SUCCESS)
            .then_some(settable)
    }

    fn full_screen(&mut self, window: u32) -> Option<bool> {
        Some(copy(element(window)?.get(), c"AXFullScreen").is_some_and(|v| cf::boolean(v.get())))
    }

    fn set_position(&mut self, window: u32, x: f64, y: f64) -> bool {
        let point = CgPoint { x, y };
        // SAFETY: `point` matches the CGPoint kind; +1 value.
        let value = Owned::new(unsafe { AXValueCreate(VALUE_CGPOINT, (&raw const point).cast()) });
        element(window)
            .zip(value)
            .is_some_and(|(e, v)| set(e.get(), c"AXPosition", v.get()))
    }

    fn set_size(&mut self, window: u32, width: f64, height: f64) -> bool {
        let size = CgSize { width, height };
        // SAFETY: `size` matches the CGSize kind; +1 value.
        let value = Owned::new(unsafe { AXValueCreate(VALUE_CGSIZE, (&raw const size).cast()) });
        element(window)
            .zip(value)
            .is_some_and(|(e, v)| set(e.get(), c"AXSize", v.get()))
    }

    fn minimized(&mut self, window: u32) -> Option<bool> {
        Some(copy(element(window)?.get(), c"AXMinimized").is_some_and(|v| cf::boolean(v.get())))
    }

    fn set_minimized(&mut self, window: u32, minimized: bool) -> bool {
        element(window).is_some_and(|e| set(e.get(), c"AXMinimized", boolean(minimized)))
    }

    fn ax_windows(&mut self, pid: u32) -> Vec<FoundWindow> {
        windows_of(pid)
            .into_iter()
            .map(|e| FoundWindow {
                number: number_of(e.get()),
                role: copy(e.get(), c"AXRole")
                    .and_then(|v| cf::string(v.get()))
                    .unwrap_or_default(),
                subrole: copy(e.get(), c"AXSubrole").and_then(|v| cf::string(v.get())),
                title: copy(e.get(), c"AXTitle").and_then(|v| cf::string(v.get())),
                frame: frame_of(e.get()),
            })
            .collect()
    }
}
