//! The on-screen windows at the pop-up menu level: an open context menu or a
//! control's menu shows there. Owner, level and bounds need no Screen
//! Recording permission, so a menu can be found and watched without a
//! capture.

use core_graphics::window::{kCGNullWindowID, kCGWindowListOptionOnScreenOnly};
use objc2_core_foundation::{CFArray, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use senpi_desktop_core::menus::open_menu::MenuWindow;

/// `kCGPopUpMenuWindowLevel`, the window level of open menus, context menus
/// included.
const POP_UP_MENU_LAYER: i64 = 101;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCopyWindowInfo(options: u32, relative_to_window: u32) -> *mut CFArray;
}

/// The global frame of a window, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct WindowFrame {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

struct MenuWindowInfo {
    number: MenuWindow,
    owner: i64,
    frame: Option<WindowFrame>,
}

/// Ids of the on-screen menu windows `pid` shows, such as an open context
/// menu, or `None` when the window list cannot be read.
pub(crate) fn menu_windows(pid: libc::pid_t) -> Option<Vec<MenuWindow>> {
    Some(
        on_screen_menus()?
            .into_iter()
            .filter(|window| window.owner == i64::from(pid))
            .map(|window| window.number)
            .collect(),
    )
}

/// The frame of menu window `window`, when it is on screen and readable.
pub(crate) fn menu_window_frame(window: MenuWindow) -> Option<WindowFrame> {
    on_screen_menus()?
        .into_iter()
        .find(|candidate| candidate.number == window)
        .and_then(|candidate| candidate.frame)
}

fn on_screen_menus() -> Option<Vec<MenuWindowInfo>> {
    // SAFETY: CoreGraphics returns a create-rule CFArray of immutable window
    // dictionaries, or null; the retained wrapper owns it for the iteration.
    let raw =
        unsafe { CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID) };
    let raw = std::ptr::NonNull::new(raw)?;
    // SAFETY: CGWindowListCopyWindowInfo gives the caller a +1 CFArray.
    let array: CFRetained<CFArray> = unsafe { CFRetained::from_raw(raw) };
    // SAFETY: Each entry in the CoreGraphics window-info array is a CFDictionary.
    let array = unsafe { CFRetained::cast_unchecked::<CFArray<CFDictionary>>(array) };
    let keys = Keys::new();
    Some(array.iter().filter_map(|entry| keys.menu(&entry)).collect())
}

struct Keys {
    pid: CFRetained<CFString>,
    number: CFRetained<CFString>,
    layer: CFRetained<CFString>,
    bounds: CFRetained<CFString>,
}

impl Keys {
    fn new() -> Self {
        Self {
            pid: CFString::from_str("kCGWindowOwnerPID"),
            number: CFString::from_str("kCGWindowNumber"),
            layer: CFString::from_str("kCGWindowLayer"),
            bounds: CFString::from_str("kCGWindowBounds"),
        }
    }

    fn menu(&self, entry: &CFRetained<CFDictionary>) -> Option<MenuWindowInfo> {
        // SAFETY: CoreGraphics window-info dictionaries have CFString keys and
        // CFType values; the downcasts below reject absent or wrong types.
        let entry =
            unsafe { CFRetained::cast_unchecked::<CFDictionary<CFString, CFType>>(entry.clone()) };
        if number(&entry, &self.layer)? != POP_UP_MENU_LAYER {
            return None;
        }
        let bounds = entry
            .get(&self.bounds)
            .and_then(|bounds| bounds.downcast::<CFDictionary>().ok());
        Some(MenuWindowInfo {
            number: MenuWindow(u32::try_from(number(&entry, &self.number)?).ok()?),
            owner: number(&entry, &self.pid)?,
            frame: bounds.and_then(frame),
        })
    }
}

fn number(entry: &CFDictionary<CFString, CFType>, key: &CFString) -> Option<i64> {
    entry.get(key)?.downcast::<CFNumber>().ok()?.as_i64()
}

/// `kCGWindowBounds` is `CGRectCreateDictionaryRepresentation`'s dictionary:
/// `X`, `Y`, `Width` and `Height` numbers.
fn frame(bounds: CFRetained<CFDictionary>) -> Option<WindowFrame> {
    // SAFETY: The rect dictionary has CFString keys and CFNumber values.
    let bounds = unsafe { CFRetained::cast_unchecked::<CFDictionary<CFString, CFType>>(bounds) };
    let read = |key: &str| {
        bounds
            .get(&CFString::from_str(key))?
            .downcast::<CFNumber>()
            .ok()?
            .as_f64()
    };
    Some(WindowFrame {
        x: read("X")?,
        y: read("Y")?,
        width: read("Width")?,
        height: read("Height")?,
    })
}
