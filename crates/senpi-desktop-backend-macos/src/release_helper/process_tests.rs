use std::io::Write;
use std::os::unix::net::UnixStream;
use std::time::Duration;

use super::process::closed_within;

#[test]
fn a_helper_that_exited_before_the_request_ended_counts_as_closed() {
    // Given: the helper wrote READY, then exited, before the engine looked.
    let (ours, mut theirs) = UnixStream::pair().expect("socket pair");
    theirs.write_all(&[1]).expect("READY");
    drop(theirs);
    // When / Then
    assert!(closed_within(&ours, Duration::from_millis(500)));
}

#[test]
fn a_helper_still_running_is_not_closed_once_the_wait_is_over() {
    // Given
    let (ours, _theirs) = UnixStream::pair().expect("socket pair");
    // When / Then: the wait itself is the behaviour under test.
    assert!(!closed_within(&ours, Duration::from_millis(20)));
}
