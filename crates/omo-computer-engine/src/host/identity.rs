//! Who is listening at the host's address (G1 item 3, R70k C-1). A reply may loosen the run
//! only after the listener passed this check. Linux has no code-identity datum: its leg is the
//! peer's uid (`SO_PEERCRED`), equal to ours. macOS (audit token + designated requirement, row
//! 40) and Windows (pipe server image + signer, row 60) are owed legs; until an OS has its leg
//! the REAL check answers `Failed`, never `Passed`, so a connected listener reads as latch SET.
//! Under the fake-backend seam the verdict is scripted by the test's host (R70k choice 1).

use std::os::unix::net::UnixStream;

use omo_computer_core::host_paths::HostPaths;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Identity {
    Passed,
    Failed,
    ForeignUid,
}

pub trait ListenerIdentity {
    fn check(&self, stream: &UnixStream) -> Identity;
}

/// `<runtime>/fake-host-identity`: `pass`, `fail` or `foreign-uid`; absent cannot identify.
struct Scripted(std::path::PathBuf);

impl ListenerIdentity for Scripted {
    fn check(&self, _stream: &UnixStream) -> Identity {
        match std::fs::read_to_string(&self.0).as_deref().map(str::trim) {
            Ok("pass") => Identity::Passed,
            Ok("foreign-uid") => Identity::ForeignUid,
            _ => Identity::Failed,
        }
    }
}

struct Real;

impl ListenerIdentity for Real {
    fn check(&self, stream: &UnixStream) -> Identity {
        os_leg(stream)
    }
}

#[cfg(target_os = "linux")]
fn os_leg(stream: &UnixStream) -> Identity {
    match peer_uid(stream) {
        Some(uid) if uid == super::files::euid() => Identity::Passed,
        Some(_) => Identity::ForeignUid,
        None => Identity::Failed,
    }
}

#[cfg(not(target_os = "linux"))]
fn os_leg(_stream: &UnixStream) -> Identity {
    Identity::Failed
}

#[cfg(target_os = "linux")]
fn peer_uid(stream: &UnixStream) -> Option<u32> {
    peer_credentials(stream).map(|(uid, _)| uid)
}

/// The connected peer's `(uid, pid)` from `SO_PEERCRED`.
#[cfg(target_os = "linux")]
pub fn peer_credentials(stream: &UnixStream) -> Option<(u32, i32)> {
    use std::os::fd::AsRawFd;
    let mut cred = libc::ucred { pid: 0, uid: 0, gid: 0 };
    let mut len = libc::socklen_t::try_from(std::mem::size_of::<libc::ucred>()).ok()?;
    // SAFETY: the descriptor is live and cred/len describe a writable ucred of that size.
    let status = unsafe {
        libc::getsockopt(
            stream.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_PEERCRED,
            std::ptr::addr_of_mut!(cred).cast(),
            &raw mut len,
        )
    };
    (status == 0).then_some((cred.uid, cred.pid))
}

#[cfg(not(target_os = "linux"))]
pub fn peer_credentials(_stream: &UnixStream) -> Option<(u32, i32)> {
    None
}

pub fn checker(paths: &HostPaths, fake: bool) -> Box<dyn ListenerIdentity> {
    if fake {
        Box::new(Scripted(paths.config.join("fake-host-identity")))
    } else {
        Box::new(Real)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn a_real_build_without_its_os_leg_never_passes_a_same_uid_listener() {
        let (ours, _theirs) = UnixStream::pair().expect("a same-uid pair");
        assert_eq!(Real.check(&ours), Identity::Failed);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_linux_leg_passes_only_our_own_uid() {
        let (ours, _theirs) = UnixStream::pair().expect("a same-uid pair");
        assert_eq!(Real.check(&ours), Identity::Passed);
    }

    #[test]
    fn an_absent_scripted_verdict_cannot_identify() {
        let (ours, _theirs) = UnixStream::pair().expect("a pair");
        let dir = tempfile::tempdir().expect("dir");
        assert_eq!(Scripted(dir.path().join("fake-host-identity")).check(&ours), Identity::Failed);
        std::fs::write(dir.path().join("fake-host-identity"), "pass").expect("verdict");
        assert_eq!(Scripted(dir.path().join("fake-host-identity")).check(&ours), Identity::Passed);
    }
}
