//! `CGWindowListCopyWindowInfo` and the display list.

use omo_computer_core::listing::Rect;

use super::cf::{self, CfRef, CgRect, Owned};
use crate::capture::types::{CgWindow, DisplayRecord};

const LIST_OPTION_ALL: u32 = 0;
const NULL_WINDOW: u32 = 0;
const MAX_DISPLAYS: u32 = 32;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CfRef;
    static kCGWindowNumber: CfRef;
    static kCGWindowOwnerPID: CfRef;
    static kCGWindowOwnerName: CfRef;
    static kCGWindowName: CfRef;
    static kCGWindowBounds: CfRef;
    static kCGWindowLayer: CfRef;
    static kCGWindowIsOnscreen: CfRef;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> CgRect;
    fn CGMainDisplayID() -> u32;
    fn CGDisplayCopyDisplayMode(display: u32) -> CfRef;
    fn CGDisplayModeGetPixelWidth(mode: CfRef) -> usize;
    fn CGDisplayModeGetPixelHeight(mode: CfRef) -> usize;
}

pub const fn rect(r: CgRect) -> Rect {
    Rect {
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
    }
}

/// Every window record, front to back; `None` when the window server answers nothing.
pub fn windows() -> Option<Vec<CgWindow>> {
    // SAFETY: plain call; the result is a +1 CFArray or null.
    let list = Owned::new(unsafe { CGWindowListCopyWindowInfo(LIST_OPTION_ALL, NULL_WINDOW) })?;
    // SAFETY: `list` is a CFArray.
    let count = unsafe { cf::CFArrayGetCount(list.get()) };
    let mut out = Vec::with_capacity(usize::try_from(count).unwrap_or(0));
    for index in 0..count {
        // SAFETY: `index` is in bounds; the element is a CFDictionary owned by the array.
        let entry = unsafe { cf::CFArrayGetValueAtIndex(list.get(), index) };
        if let Some(window) = window(entry) {
            out.push(window);
        }
    }
    Some(out)
}

fn window(entry: CfRef) -> Option<CgWindow> {
    // SAFETY: the keys are CoreGraphics constants valid for the process lifetime.
    let (number, pid, owner, name, bounds, layer, on_screen) = unsafe {
        (
            kCGWindowNumber,
            kCGWindowOwnerPID,
            kCGWindowOwnerName,
            kCGWindowName,
            kCGWindowBounds,
            kCGWindowLayer,
            kCGWindowIsOnscreen,
        )
    };
    Some(CgWindow {
        number: u32::try_from(cf::int(cf::get(entry, number))?).ok()?,
        pid: u32::try_from(cf::int(cf::get(entry, pid))?).ok()?,
        owner: cf::string(cf::get(entry, owner)).unwrap_or_default(),
        title: cf::string(cf::get(entry, name)).unwrap_or_default(),
        bounds: rect(cf::rect(cf::get(entry, bounds))?),
        layer: i32::try_from(cf::int(cf::get(entry, layer)).unwrap_or(0)).unwrap_or(i32::MAX),
        on_screen: cf::boolean(cf::get(entry, on_screen)),
    })
}

/// The active displays; `None` when the list cannot be read.
pub fn displays() -> Option<Vec<DisplayRecord>> {
    let mut ids = [0u32; MAX_DISPLAYS as usize];
    let mut count = 0u32;
    // SAFETY: `ids` holds MAX_DISPLAYS entries.
    let status = unsafe { CGGetActiveDisplayList(MAX_DISPLAYS, ids.as_mut_ptr(), &raw mut count) };
    if status != 0 {
        return None;
    }
    // SAFETY: plain call.
    let main = unsafe { CGMainDisplayID() };
    let ids = ids.get(..count as usize)?;
    Some(ids.iter().map(|&id| display(id, id == main)).collect())
}

fn display(id: u32, main: bool) -> DisplayRecord {
    // SAFETY: `id` came from the active display list.
    let bounds = rect(unsafe { CGDisplayBounds(id) });
    // SAFETY: the mode is a +1 reference or null.
    let mode = Owned::new(unsafe { CGDisplayCopyDisplayMode(id) });
    let (width, height) = mode.map_or((0, 0), |mode| {
        // SAFETY: `mode` is a valid CGDisplayMode.
        unsafe {
            (
                CGDisplayModeGetPixelWidth(mode.get()),
                CGDisplayModeGetPixelHeight(mode.get()),
            )
        }
    });
    DisplayRecord {
        id,
        bounds,
        pixel_width: u32::try_from(width).unwrap_or(0),
        pixel_height: u32::try_from(height).unwrap_or(0),
        main,
    }
}
