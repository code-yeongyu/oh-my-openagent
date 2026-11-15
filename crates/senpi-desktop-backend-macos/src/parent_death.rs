//! Ends a private helper when the engine that started it dies (G16): a
//! kqueue `NOTE_EXIT` watch on the parent, so a `kill -9` of the engine
//! leaves no helper behind even when nothing closes the helper's stdin.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::ptr;

/// Watches this process's parent on its own thread and ends the process with
/// `_exit(0)` when the parent exits. A parent that died before the watch was
/// registered ends it at once.
///
/// # Errors
/// The kqueue or thread could not be set up; the caller keeps its other
/// exit paths (stdin EOF, deadlines).
pub(crate) fn exit_with_parent() -> io::Result<()> {
    // SAFETY: [FFI] getppid takes no arguments and cannot fail.
    let parent = unsafe { libc::getppid() };
    // SAFETY: [FFI] kqueue takes no arguments and returns a new descriptor.
    let fd = unsafe { libc::kqueue() };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: [double free] `fd` is a new descriptor nothing else owns.
    let queue = unsafe { OwnedFd::from_raw_fd(fd) };
    let change = libc::kevent {
        ident: usize::try_from(parent).map_err(io::Error::other)?,
        filter: libc::EVFILT_PROC,
        flags: libc::EV_ADD | libc::EV_ONESHOT,
        fflags: libc::NOTE_EXIT,
        data: 0,
        udata: ptr::null_mut(),
    };
    // SAFETY: [FFI] one initialized change, no output events, live descriptor.
    let registered = unsafe { libc::kevent(queue.as_raw_fd(), &change, 1, ptr::null_mut(), 0, ptr::null()) };
    if registered < 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            orphaned();
        }
        return Err(error);
    }
    // SAFETY: [FFI] as above. A parent that exited before the registration
    // left this process reparented, so its parent pid changed.
    if unsafe { libc::getppid() } != parent {
        orphaned();
    }
    std::thread::Builder::new()
        .name("parent-death".to_owned())
        .spawn(move || loop {
            let mut event = std::mem::MaybeUninit::<libc::kevent>::uninit();
            // SAFETY: [FFI] room for one output event, no changes, no timeout.
            let fired = unsafe { libc::kevent(queue.as_raw_fd(), ptr::null(), 0, event.as_mut_ptr(), 1, ptr::null()) };
            if fired > 0 {
                orphaned();
            }
            let error = io::Error::last_os_error();
            if fired < 0 && error.kind() != io::ErrorKind::Interrupted {
                eprintln!("parent-death: watch failed, relying on the other exit paths: {error}");
                return;
            }
        })?;
    Ok(())
}

fn orphaned() -> ! {
    // SAFETY: [FFI] `_exit` ends the process without running destructors;
    // the OS closes its windows, event taps and file locks.
    unsafe { libc::_exit(0) }
}
