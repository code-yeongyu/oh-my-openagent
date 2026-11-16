//! Admission of one accepted connection, before any frame is decoded (d-remote.md:113, :204):
//! the peer's uid must be ours, its pid must be on the allowlist {spawning host, launcher,
//! `hand.register`-ed peers}, then the raw 32-byte capability preamble is read as bytes and
//! compared constant-time. Under the fake backend only, a `fake-peer` verdict file in the runtime
//! dir can TIGHTEN the observed credential (`foreign-uid` | `unregistered`); a real backend never
//! reads it (lead decision Q3 A).

use std::io::Read;
use std::os::unix::net::UnixStream;
use std::path::Path;

use super::state::{Grant, Shared};
use crate::host::identity::peer_credentials;

pub const CAPABILITY_LEN: usize = 32;
pub type Capability = [u8; CAPABILITY_LEN];

#[must_use]
pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && left.iter().zip(right).fold(0u8, |acc, (l, r)| acc | (l ^ r)) == 0
}

enum Verdict {
    Observed,
    ForeignUid,
    Unregistered,
}

fn scripted_verdict(runtime: &Path, fake: bool) -> Verdict {
    if !fake {
        return Verdict::Observed;
    }
    match std::fs::read_to_string(runtime.join("fake-peer")).as_deref().map(str::trim) {
        Ok("foreign-uid") => Verdict::ForeignUid,
        Ok("unregistered") => Verdict::Unregistered,
        _ => Verdict::Observed,
    }
}

/// The grant this connection holds, or `None` when it must be closed `unauthorized` unread.
pub fn admit(stream: &mut UnixStream, shared: &Shared) -> Option<Grant> {
    let (uid, pid) = peer_credentials(stream)?;
    let verdict = scripted_verdict(&shared.runtime, shared.fake);
    if uid != crate::host::files::euid() || matches!(verdict, Verdict::ForeignUid) {
        return None;
    }
    if matches!(verdict, Verdict::Unregistered) || !shared.allows_pid(pid) {
        return None;
    }
    let mut preamble: Capability = [0; CAPABILITY_LEN];
    stream.read_exact(&mut preamble).ok()?;
    shared.bind(&preamble)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_comparison_needs_every_byte_and_the_length() {
        assert!(constant_time_eq(&[1, 2, 3], &[1, 2, 3]));
        assert!(!constant_time_eq(&[1, 2, 3], &[1, 2, 4]));
        assert!(!constant_time_eq(&[1, 2], &[1, 2, 3]));
    }

    #[test]
    fn a_real_backend_never_reads_the_verdict_file() {
        let dir = tempfile::tempdir().expect("dir");
        std::fs::write(dir.path().join("fake-peer"), "foreign-uid").expect("verdict");
        assert!(matches!(scripted_verdict(dir.path(), false), Verdict::Observed));
        assert!(matches!(scripted_verdict(dir.path(), true), Verdict::ForeignUid));
    }
}
