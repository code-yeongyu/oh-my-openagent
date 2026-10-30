//! The helper's signals: a kill of the engine's process group or session
//! (SIGHUP, SIGTERM, SIGINT) never ends it before its releases are out, while
//! its release deadline (SIGALRM) and the engine abandoning it (SIGUSR1) end
//! it at once, after its event tap is closed.

use std::ptr;
use std::thread;

use super::tap;

/// How long releasing may take once the stream ends before SIGALRM ends the
/// helper.
pub(crate) const RELEASE_DEADLINE_SECONDS: u32 = 2;
/// The signal the engine sends a helper that missed part of its stream, so it
/// exits without releasing a key the engine may still hold.
pub(crate) const ABANDON: libc::c_int = libc::SIGUSR1;

pub(crate) fn ignore_group_signals() {
    for signal in [libc::SIGHUP, libc::SIGTERM, libc::SIGINT, libc::SIGPIPE] {
        // SAFETY: [FFI] ignoring a signal has no preconditions.
        unsafe { libc::signal(signal, libc::SIG_IGN) };
    }
}

fn set_of(signals: &[libc::c_int]) -> libc::sigset_t {
    // SAFETY: [uninit] `sigemptyset` initialises the set before `sigaddset`
    // reads it; a zeroed `sigset_t` is a valid value to start from.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        for &signal in signals {
            libc::sigaddset(&mut set, signal);
        }
        set
    }
}

/// Blocks SIGALRM and SIGUSR1 before any other thread starts, so only the
/// thread started here takes them: it closes the tap, then exits posting
/// nothing more. SIGALRM, unblocked there, still ends the helper a second
/// later if closing the tap hangs.
pub(crate) fn end_on_deadline_or_abandon() -> Result<(), String> {
    let ending = set_of(&[libc::SIGALRM, ABANDON]);
    // SAFETY: [FFI] changes this thread's mask, which threads it starts inherit.
    unsafe { libc::pthread_sigmask(libc::SIG_BLOCK, &ending, ptr::null_mut()) };
    thread::Builder::new()
        .name("end-on-signal".to_owned())
        .spawn(move || {
            let mut received = 0;
            // SAFETY: [FFI] both pointers are live for the call.
            unsafe { libc::sigwait(&ending, &mut received) };
            let alarm = set_of(&[libc::SIGALRM]);
            // SAFETY: [FFI] scheduling SIGALRM and changing this thread's mask
            // have no preconditions.
            unsafe {
                libc::alarm(1);
                libc::pthread_sigmask(libc::SIG_UNBLOCK, &alarm, ptr::null_mut());
            }
            tap::close();
            // SAFETY: [FFI] ends the process at once, as the signal would have.
            unsafe { libc::_exit(0) }
        })
        .map(drop)
        .map_err(|error| format!("cannot start the signal thread: {error}"))
}

pub(crate) fn start_release_deadline() {
    // SAFETY: [FFI] scheduling SIGALRM has no preconditions.
    unsafe { libc::alarm(RELEASE_DEADLINE_SECONDS) };
}
