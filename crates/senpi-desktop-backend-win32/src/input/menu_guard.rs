//! Menu-only refusal for known UIA providers that activate background windows.

use senpi_desktop_core::error::CoreResult;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

use super::native::Window;
use crate::integrity::IntegrityRid;

struct Process(HANDLE);

impl Drop for Process {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns exactly one successful OpenProcess handle.
        unsafe { CloseHandle(self.0) };
    }
}

fn image_name(window: Window) -> Option<String> {
    let pid = window.process_id()?;
    // SAFETY: scalar PID and read-only query access; null is handled below.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let process = Process(handle);
    let mut path = vec![0u16; 1024];
    let mut length = path.len() as u32;
    // SAFETY: process is live and path is writable for the advertised units.
    if unsafe {
        QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut length)
    } == 0 {
        return None;
    }
    let path = path.get(..length as usize)?;
    Some(String::from_utf16_lossy(path))
}

pub(crate) fn menu_pattern_safe(id: &str, integrity: IntegrityRid) -> CoreResult<()> {
    let window = Window::target(id, integrity)?;
    if window.owns_foreground() {
        return Ok(());
    }
    crate::menus::pattern_guard::require_safe(
        &window.class_name(),
        image_name(window).as_deref(),
        window.has_chromium_descendant(),
    )
}
