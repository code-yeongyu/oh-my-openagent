//! Starting, stopping and reaping the release helper process.

use std::io::{self, Read};
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::net::UnixStream;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};
use std::{ptr, thread};

use super::guard::Helper;
use super::poster::{RECORD_ENV, USER_HOLDS_ENV};
use super::run::encode_token;
use super::signals::ABANDON;
use super::wire::{Record, TOKEN_LEN, VERSION};

/// How long a stalled helper may hold up input before the request goes on
/// without it.
const WRITE_TIMEOUT: Duration = Duration::from_millis(100);
/// How long an abandoned helper may take to close its tap and exit.
const STOP_TIMEOUT: Duration = Duration::from_millis(100);

/// Starts this executable as the release helper of this process, with one end
/// of a socket pair as its standard input. The helper checks that its parent
/// is the pid on its argv and that the stream opens with the argv's token.
pub(crate) fn spawn() -> io::Result<Helper> {
    let (socket, theirs) = UnixStream::pair()?;
    no_sigpipe(&socket)?;
    socket.set_write_timeout(Some(WRITE_TIMEOUT))?;
    let token = token()?;
    let child = Command::new(std::env::current_exe()?)
        .args(["--release-helper", "--parent", &std::process::id().to_string(), "--token", &encode_token(&token)])
        .stdin(Stdio::from(OwnedFd::from(theirs)))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env_remove(RECORD_ENV)
        .env_remove(USER_HOLDS_ENV)
        .spawn()?;
    let mut helper = Helper::new(Some(child), socket, false);
    if let Err(error) = helper.write(&Record::Hello { version: VERSION, token }) {
        if let Some(child) = helper.child.as_mut() {
            stop(child);
        }
        return Err(error);
    }
    Ok(helper)
}

fn token() -> io::Result<[u8; TOKEN_LEN]> {
    let mut token = [0; TOKEN_LEN];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut token)?;
    Ok(token)
}

/// A write to an exited helper then fails instead of raising SIGPIPE here.
fn no_sigpipe(socket: &UnixStream) -> io::Result<()> {
    let enabled: libc::c_int = 1;
    // SAFETY: [FFI] `socket` owns a live descriptor and the option value
    // outlives the call.
    let result = unsafe {
        libc::setsockopt(
            socket.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_NOSIGPIPE,
            ptr::from_ref(&enabled).cast(),
            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Whether the helper closed its end of the stream, which it does only by
/// exiting, within `wait`.
pub(crate) fn closed_within(socket: &UnixStream, wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    let mut reader = socket;
    let mut bytes = [0u8; 16];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return false;
        }
        // macOS refuses a receive timeout (EINVAL) on a socket whose peer
        // already hung up, so that refusal is answered by a read that cannot
        // block.
        if reader.set_read_timeout(Some(left)).is_err() {
            return hung_up(socket);
        }
        match reader.read(&mut bytes) {
            Ok(0) => return true,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(_) => return false,
        }
    }
}

/// Whether the peer closed its end, read without blocking.
fn hung_up(socket: &UnixStream) -> bool {
    let mut reader = socket;
    let mut bytes = [0u8; 16];
    if reader.set_nonblocking(true).is_err() {
        return false;
    }
    loop {
        match reader.read(&mut bytes) {
            Ok(0) => return true,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(_) => return false,
        }
    }
}

pub(crate) fn reap(child: &mut Child) {
    if let Err(error) = child.wait() {
        eprintln!("release helper: reaping: {error}");
    }
}

/// Reaps a helper still posting releases off the input thread. When no thread
/// can start for that, it is reaped here; it ends itself within its release
/// deadline.
pub(crate) fn reap_detached(child: Child) {
    let shared = Arc::new(Mutex::new(Some(child)));
    let take = |shared: &Mutex<Option<Child>>| shared.lock().unwrap_or_else(PoisonError::into_inner).take();
    let detached = Arc::clone(&shared);
    let spawned = thread::Builder::new().name("release-helper-reaper".to_owned()).spawn(move || {
        if let Some(mut child) = take(&detached) {
            reap(&mut child);
        }
    });
    if let Err(error) = spawned {
        eprintln!("release helper: no reaper thread, reaping inline: {error}");
        if let Some(mut child) = take(&shared) {
            reap(&mut child);
        }
    }
}

/// Stops and reaps a helper: it is asked with [`ABANDON`] first and closes
/// its event tap before it exits, since one killed with its tap live can make
/// the user's key arrive twice.
pub(crate) fn stop(child: &mut Child) {
    // SAFETY: [FFI] the helper is this process's unreaped child, so its pid
    // cannot have been reused.
    let asked = libc::pid_t::try_from(child.id()).is_ok_and(|pid| unsafe { libc::kill(pid, ABANDON) } == 0);
    let deadline = Instant::now() + STOP_TIMEOUT;
    while asked && Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
        thread::sleep(Duration::from_millis(2));
    }
    if matches!(child.try_wait(), Ok(None)) {
        if let Err(error) = child.kill() {
            eprintln!("release helper: killing: {error}");
        }
    }
    reap(child);
}
