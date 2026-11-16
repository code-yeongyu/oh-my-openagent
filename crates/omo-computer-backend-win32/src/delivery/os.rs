//! The live delivery seam: user32 reads, the integrity RIDs through row 55's token read, the
//! crate's one `PostMessageW` site, and the paint reads of the consumed hop.

use std::time::{Duration, Instant};

use omo_computer_core::params::Point;
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, E_ACCESSDENIED, HWND, LPARAM, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetUpdateRect, InvalidateRect, ScreenToClient};
use windows::Win32::System::Threading::{
    GetCurrentProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
use windows::Win32::UI::WindowsAndMessaging::{
    ChildWindowFromPointEx, EnumChildWindows, GetClassNameW, GetClientRect,
    GetWindowThreadProcessId, IsChild, IsIconic, IsWindow, IsWindowVisible, SendMessageTimeoutW,
    CWP_SKIPDISABLED, CWP_SKIPINVISIBLE, CWP_SKIPTRANSPARENT, DLGC_WANTCHARS, SMTO_ABORTIFHUNG,
    WM_GETDLGCODE,
};

use crate::barrier::PaintOs;
use crate::capture::integrity::rid;
use crate::input::focus_child::{self, FocusOs};
use crate::input::Posted;

use super::hit::{deepest_child, HitOs};
use super::integrity::Integrity;
use super::target::{ClientPoint, DeliveryOs, PostFailure};
/// `WM_GETDLGCODE` answer budget per child; a hung child is not a candidate.
const DLGCODE_TIMEOUT_MS: u32 = 100;

fn hwnd(window: isize) -> HWND {
    HWND(window as *mut core::ffi::c_void)
}

/// The live seam.
pub struct Os;

impl FocusOs for Os {
    fn window_thread(&self, window: isize) -> Option<u32> {
        focus_child::Os.window_thread(window)
    }

    fn thread_focus(&self, thread: u32) -> Option<isize> {
        focus_child::Os.thread_focus(thread)
    }
}

impl PaintOs for Os {
    fn paintable(&self, window: isize) -> bool {
        // SAFETY: plain reads; any HWND value is accepted.
        unsafe { !IsIconic(hwnd(window)).as_bool() && IsWindowVisible(hwnd(window)).as_bool() }
    }

    fn invalidate_pixel(&mut self, window: isize) -> bool {
        let pixel = RECT {
            left: 0,
            top: 0,
            right: 1,
            bottom: 1,
        };
        // SAFETY: `pixel` outlives the call.
        unsafe { InvalidateRect(Some(hwnd(window)), Some(&raw const pixel), false) }.as_bool()
    }

    fn update_pending(&self, window: isize) -> bool {
        // SAFETY: no rectangle is written.
        unsafe { GetUpdateRect(hwnd(window), None, false) }.as_bool()
    }

    fn wait(&mut self, period: Duration) -> Duration {
        let start = Instant::now();
        std::thread::sleep(period);
        start.elapsed()
    }
}

impl HitOs for Os {
    fn to_client(&self, window: isize, screen: (i32, i32)) -> Option<(i32, i32)> {
        let mut point = POINT {
            x: screen.0,
            y: screen.1,
        };
        // SAFETY: `point` outlives the call.
        unsafe { ScreenToClient(hwnd(window), &raw mut point) }
            .as_bool()
            .then_some((point.x, point.y))
    }

    fn client_size(&self, window: isize) -> Option<(i32, i32)> {
        let mut rect = RECT::default();
        // SAFETY: `rect` outlives the call.
        unsafe { GetClientRect(hwnd(window), &raw mut rect) }.ok()?;
        Some((rect.right - rect.left, rect.bottom - rect.top))
    }

    fn child_from_point(&self, window: isize, client: (i32, i32)) -> Option<isize> {
        let flags = CWP_SKIPINVISIBLE | CWP_SKIPDISABLED | CWP_SKIPTRANSPARENT;
        let point = POINT {
            x: client.0,
            y: client.1,
        };
        // SAFETY: a plain hit-test in `window`'s client coordinates.
        let child = unsafe { ChildWindowFromPointEx(hwnd(window), point, flags) };
        (!child.is_invalid()).then_some(child.0 as isize)
    }
}

unsafe extern "system" fn collect(child: HWND, found: LPARAM) -> BOOL {
    let mut code = 0usize;
    // SAFETY: a bounded, abort-if-hung query; `code` outlives the call.
    let answered = unsafe {
        IsWindowVisible(child).as_bool()
            && IsWindowEnabled(child).as_bool()
            && SendMessageTimeoutW(
                child,
                WM_GETDLGCODE,
                WPARAM(0),
                LPARAM(0),
                SMTO_ABORTIFHUNG,
                DLGCODE_TIMEOUT_MS,
                Some(&raw mut code),
            )
            .0 != 0
    };
    if answered && code & DLGC_WANTCHARS as usize != 0 {
        // SAFETY: `found` is the `Vec` `wants_chars` passed, alive for the whole enumeration.
        unsafe { (*(found.0 as *mut Vec<isize>)).push(child.0 as isize) };
    }
    true.into()
}

impl DeliveryOs for Os {
    fn alive(&self, window: isize) -> bool {
        // SAFETY: any HWND value is accepted.
        unsafe { IsWindow(Some(hwnd(window))) }.as_bool()
    }

    fn class(&self, window: isize) -> Option<String> {
        let mut name = [0u16; 256];
        // SAFETY: the buffer and its length come from one slice.
        let len = usize::try_from(unsafe { GetClassNameW(hwnd(window), &mut name) }).ok()?;
        (len > 0).then(|| String::from_utf16_lossy(name.get(..len).unwrap_or_default()))
    }

    fn integrity(&self, window: isize) -> Integrity {
        let mut pid = 0u32;
        // SAFETY: plain out-parameter.
        unsafe { GetWindowThreadProcessId(hwnd(window), Some(&raw mut pid)) };
        // SAFETY: a pseudo-handle for this process; no close needed.
        let engine = rid(unsafe { GetCurrentProcess() });
        // SAFETY: a query-only open; closed below.
        let Ok(process) = (unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) })
        else {
            return Integrity::Unreadable;
        };
        let target = rid(process);
        // SAFETY: opened above; a failed close leaks one handle and changes no answer.
        if unsafe { CloseHandle(process) }.is_err() {
            eprintln!("omo-computer-backend-win32: CloseHandle failed after the integrity read");
        }
        match (target, engine) {
            (Some(target), Some(engine)) => Integrity::Rids { target, engine },
            _ => Integrity::Unreadable,
        }
    }

    fn within(&self, window: isize, top: isize) -> bool {
        // SAFETY: plain reads; any HWND value is accepted.
        window == top || unsafe { IsChild(hwnd(top), hwnd(window)) }.as_bool()
    }

    fn wants_chars(&self, window: isize) -> Vec<isize> {
        let mut found: Vec<isize> = Vec::new();
        // SAFETY: `collect` writes only into `found`, which outlives the synchronous enumeration.
        let _done = unsafe {
            EnumChildWindows(
                Some(hwnd(window)),
                Some(collect),
                LPARAM(&raw mut found as isize),
            )
        };
        found
    }

    fn child_at(&self, window: isize, at: Point) -> Option<(isize, ClientPoint)> {
        deepest_child(self, window, at)
    }

    fn post(&mut self, window: isize, message: &Posted) -> Result<(), PostFailure> {
        crate::input::os::post(window, message).map_err(|error| {
            if error.code() == E_ACCESSDENIED {
                PostFailure::AccessDenied
            } else {
                PostFailure::Failed
            }
        })
    }
}
