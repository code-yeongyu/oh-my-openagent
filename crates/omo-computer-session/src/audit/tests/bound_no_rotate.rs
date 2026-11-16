//! R7-7 bound test (5): an authority that may not rotate. With audit.1.jsonl unreadable, the
//! authority writer at hard_cap does not rotate: exec is refused audit_unavailable and the file
//! does not grow past hard_cap + max_event.

use std::fs;

use super::bound_fixture::{Big, HAND, LIMITS};
use crate::audit::{Anchor, AuditEvent, AuditSink, AuditWriter, WriterId, AUDIT_UNAVAILABLE};

#[cfg(unix)]
#[test]
fn bound_5_an_authority_that_cannot_read_the_retired_file_does_not_rotate_and_is_refused_at_the_cap() {
    use std::os::unix::fs::PermissionsExt;
    let mut big = Big::new();
    let (retired, current) = (big.retired(), big.current());
    big.fill(&retired, true, None);
    big.fill(&current, true, None);
    let file = fs::OpenOptions::new().write(true).open(&current).expect("open");
    file.set_len(LIMITS.hard_cap).expect("the current file at hard_cap");
    drop(file);
    fs::set_permissions(&retired, fs::Permissions::from_mode(0o000)).expect("unreadable");
    let anchor = Anchor { fingerprint: "fp".to_owned(), suspended: false, stop_epoch: 0 };
    let id = WriterId { pid: 77, proc_start_ms: 7 };
    let opened = AuditWriter::open_authority(big.dir.path(), HAND, 1, id, LIMITS, anchor);
    let size = || fs::metadata(&current).expect("stat").len();
    if let Ok(mut host) = opened {
        assert_eq!(host.admit(), Err(AUDIT_UNAVAILABLE), "refused at hard_cap");
        let event = AuditEvent { action: "click".to_owned(), target: "window:101".to_owned(), ..AuditEvent::default() };
        assert!(host.append(event).is_err(), "no rotation, no append past the cap");
    }
    assert!(retired.exists(), "the retired file is not replaced");
    assert!(size() <= LIMITS.hard_cap + LIMITS.max_event, "{}", size());
    fs::set_permissions(&retired, fs::Permissions::from_mode(0o600)).expect("restore for cleanup");
}
