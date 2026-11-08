//! Subscribe before the child runs; no sleeps or process-status polling.
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

pub(super) struct Event(OwnedFd);

impl Event {
    pub(super) fn subscribe(ident: usize, filter: i16, fflags: u32) -> Self {
        // SAFETY: kqueue creates a new descriptor without pointer arguments.
        let fd = unsafe { libc::kqueue() };
        assert!(fd >= 0, "kqueue: {}", std::io::Error::last_os_error());
        // SAFETY: fd is a new owned descriptor.
        let queue = Self(unsafe { OwnedFd::from_raw_fd(fd) });
        let change = libc::kevent {
            ident,
            filter,
            flags: libc::EV_ADD | libc::EV_ONESHOT,
            fflags,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        // SAFETY: one initialized change, no output events, live descriptor.
        assert_eq!(
            unsafe {
                libc::kevent(
                    queue.0.as_raw_fd(),
                    &change,
                    1,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null(),
                )
            },
            0
        );
        queue
    }

    pub(super) fn wait(&self) {
        let mut event = std::mem::MaybeUninit::<libc::kevent>::uninit();
        let timeout = libc::timespec {
            tv_sec: 15,
            tv_nsec: 0,
        };
        // SAFETY: output has room for one event; timeout is initialized.
        let count = unsafe {
            libc::kevent(
                self.0.as_raw_fd(),
                std::ptr::null(),
                0,
                event.as_mut_ptr(),
                1,
                &timeout,
            )
        };
        assert_eq!(
            count,
            1,
            "native fixture event timed out: {}",
            std::io::Error::last_os_error()
        );
        // SAFETY: exactly one initialized event was returned.
        let event = unsafe { event.assume_init() };
        assert_eq!(
            event.flags & libc::EV_ERROR,
            0,
            "native event reported an error"
        );
    }
}
