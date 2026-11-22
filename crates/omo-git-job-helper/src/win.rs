//! Owned kernel handles and the small conversions every mode shares.
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, FILETIME, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::System::Threading::GetProcessTimes;

/// A kernel handle this process owns; closed exactly once, on drop.
pub struct Owned(HANDLE);

impl Owned {
    /// Takes ownership of a handle returned by a successful kernel call; `None` for NULL or INVALID_HANDLE_VALUE.
    pub fn new(raw: HANDLE) -> Option<Self> {
        (!raw.is_null() && raw != INVALID_HANDLE_VALUE).then_some(Self(raw))
    }

    pub const fn raw(&self) -> HANDLE {
        self.0
    }

    /// Gives up ownership: the handle stays open and nothing in this process closes it.
    pub fn into_raw(self) -> HANDLE {
        std::mem::ManuallyDrop::new(self).0
    }
}

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: `self.0` came from a successful kernel call and no other owner closes it.
        unsafe { CloseHandle(self.0) };
    }
}

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The calling thread's last-error value; call it in the same frame as the failing API (design section 3, point 2).
pub fn last_error() -> u32 {
    // SAFETY: reads thread-local state only.
    unsafe { GetLastError() }
}

pub fn creation_time(process: HANDLE) -> Result<u64, u32> {
    let mut times = [FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    }; 4];
    let [created, exited, kernel, user] = &mut times;
    // SAFETY: four distinct, writable FILETIMEs owned by this frame.
    if unsafe { GetProcessTimes(process, created, exited, kernel, user) } == 0 {
        return Err(last_error());
    }
    Ok((u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime))
}
