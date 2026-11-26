//! The EIS socket is close-on-exec on every route, so no child the engine starts holds a copy:
//! engine death closes the compositor's last reference and the compositor releases what the
//! engine's virtual devices held (d-linux.md RELEASE ON ENGINE DEATH).

use std::os::fd::{AsRawFd, BorrowedFd, RawFd};

/// The engine's EIS descriptor, as a child could see it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EisFd {
    pub raw: RawFd,
    pub cloexec: bool,
}

/// Sets close-on-exec on `fd`.
///
/// # Errors
/// The `fcntl` call failed.
pub fn set_cloexec(fd: BorrowedFd<'_>) -> rustix::io::Result<()> {
    let flags = rustix::io::fcntl_getfd(fd)?;
    rustix::io::fcntl_setfd(fd, flags | rustix::io::FdFlags::CLOEXEC)
}

/// Reads `fd`'s number and close-on-exec flag.
#[must_use]
pub fn describe(fd: BorrowedFd<'_>) -> EisFd {
    let cloexec =
        rustix::io::fcntl_getfd(fd).is_ok_and(|flags| flags.contains(rustix::io::FdFlags::CLOEXEC));
    EisFd {
        raw: fd.as_raw_fd(),
        cloexec,
    }
}
