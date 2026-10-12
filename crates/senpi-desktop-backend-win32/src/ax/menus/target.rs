//! Exact live menu target, using the input backend's integrity refusal.

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetMenu, GetWindowThreadProcessId, IsWindow, GA_ROOT,
};

use crate::integrity::IntegrityRid;
use crate::menus::failed;

pub(super) struct Target {
    pub hwnd: HWND,
    pid: u32,
    thread: u32,
    integrity: IntegrityRid,
}

impl Target {
    pub fn new(window: &DesktopWindow, integrity: IntegrityRid) -> CoreResult<Self> {
        let hwnd = crate::input::menu_target(&window.id, integrity)?;
        let pid = window
            .pid
            .filter(|pid| *pid != 0)
            .ok_or_else(|| failed("cannot establish the process owning this menu target"))?;
        // SAFETY: Win32 validates the opaque HWND and accepts a null PID slot.
        let thread = unsafe { GetWindowThreadProcessId(hwnd, std::ptr::null_mut()) };
        let target = Self {
            hwnd,
            pid,
            thread,
            integrity,
        };
        target.check()?;
        Ok(target)
    }

    pub fn check(&self) -> CoreResult<()> {
        let mut pid = 0;
        // SAFETY: PID is a writable scalar; Win32 validates the opaque HWND.
        let thread = unsafe { GetWindowThreadProcessId(self.hwnd, &mut pid) };
        // SAFETY: IsWindow inspects an opaque HWND, never Rust memory.
        let live = unsafe { IsWindow(self.hwnd) } != 0;
        // SAFETY: GetAncestor validates the opaque HWND.
        let root = unsafe { GetAncestor(self.hwnd, GA_ROOT) };
        if !live || thread == 0 || thread != self.thread || pid != self.pid || root != self.hwnd {
            return Err(DesktopError::window_not_found(
                "the exact menu target no longer exists",
            ));
        }
        // SAFETY: IsWindowEnabled validates the opaque HWND.
        if unsafe { IsWindowEnabled(self.hwnd) } == 0 {
            return Err(failed(
                "the menu target is disabled; target its active dialog instead",
            ));
        }
        crate::input::menu_target(&self.hwnd.addr().to_string(), self.integrity)?;
        Ok(())
    }

    pub fn menu(&self) -> usize {
        // SAFETY: GetMenu validates the HWND and returns an opaque handle.
        unsafe { GetMenu(self.hwnd) }.addr()
    }

    pub fn attached(&self, menu: usize) -> CoreResult<()> {
        self.check()?;
        if self.menu() != menu {
            return Err(failed(
                "the target's menu changed; no command was dispatched",
            ));
        }
        Ok(())
    }

    pub fn pattern_safe(&self) -> CoreResult<()> {
        crate::input::menu_pattern_safe(&self.hwnd.addr().to_string(), self.integrity)
    }
}
