use std::cell::Cell;
use std::panic::{catch_unwind, AssertUnwindSafe};

use windows_sys::Win32::Foundation::{POINT, RECT};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging as wm;

use super::probe::ProbeWindow;
use crate::input::native::Window;

#[test]
fn pointer_routing_selects_the_deepest_enabled_child_window() {
    let root = ProbeWindow::visible("SenpiChildRouteProbe");
    let child = root.child();
    let mut rect = RECT::default();
    // SAFETY: [Category 8 - FFI boundary] the owned parent's child is live
    // and rect is a writable output slot.
    assert_ne!(unsafe { wm::GetWindowRect(child, &raw mut rect) }, 0);
    let point = POINT {
        x: rect.left + (rect.right - rect.left) / 2,
        y: rect.top + (rect.bottom - rect.top) / 2,
    };

    let routed = Window::from_hwnd(root.hwnd)
        .unwrap()
        .deepest_child(point)
        .unwrap()
        .0;

    assert_eq!(routed.address(), child.addr());
}

#[test]
fn assertion_unwind_destroys_parent_children_and_class() {
    let parent = Cell::new(std::ptr::null_mut());
    let child = Cell::new(std::ptr::null_mut());
    let caught = catch_unwind(AssertUnwindSafe(|| {
        let root = ProbeWindow::visible("SenpiUnwindRouteProbe");
        parent.set(root.hwnd);
        child.set(root.child());
        assert_eq!(1, 2, "intentional fixture unwind");
    }));
    assert!(caught.is_err());
    assert!(!parent.get().is_null());
    assert!(!child.get().is_null());
    let class: Vec<u16> = "SenpiUnwindRouteProbe".encode_utf16().chain([0]).collect();
    let mut info = wm::WNDCLASSW::default();
    // SAFETY: [Category 8 - FFI boundary] IsWindow accepts stale handles;
    // GetClassInfoW receives a valid class name and writable output slot.
    unsafe {
        assert_eq!(wm::IsWindow(parent.get()), 0);
        assert_eq!(wm::IsWindow(child.get()), 0);
        assert_eq!(
            wm::GetClassInfoW(
                GetModuleHandleW(std::ptr::null()),
                class.as_ptr(),
                &raw mut info
            ),
            0
        );
    }
}
