//! The reset-before-reply retry on every platform: only a Unix socket proves
//! that no daemon read the request.

use std::io;

use super::{before_reply, is_reset_before_reply, retry_reset_once};

#[test]
fn t25_24_only_a_unix_socket_reset_before_any_reply_byte_is_retryable() {
    use io::ErrorKind::{BrokenPipe, ConnectionReset, UnexpectedEof};
    for kind in [ConnectionReset, BrokenPipe] {
        assert!(is_reset_before_reply(&kind.into(), 0, true), "{kind:?} on a unix socket");
        assert!(!is_reset_before_reply(&kind.into(), 0, false), "{kind:?} on a named pipe");
        assert!(!is_reset_before_reply(&kind.into(), 1, true), "{kind:?} after a reply byte");
    }
    assert!(!is_reset_before_reply(&UnexpectedEof.into(), 0, true));
}

/// Fails the first attempt with a reset before any reply byte, then is served.
fn reset_then_served() -> (io::Result<u8>, usize) {
    let mut attempts = 0;
    let outcome = retry_reset_once(|| {
        attempts += 1;
        if attempts == 1 {
            Err(before_reply(io::ErrorKind::ConnectionReset.into(), 0))
        } else {
            Ok(7)
        }
    });
    (outcome, attempts)
}

#[cfg(unix)]
#[test]
fn t25_24_a_unix_socket_reset_before_the_first_reply_byte_is_retried_once() {
    let (outcome, attempts) = reset_then_served();
    assert_eq!((outcome.expect("retried"), attempts), (7, 2));
}

#[cfg(not(unix))]
#[test]
fn t25_24_a_named_pipe_reset_before_the_first_reply_byte_is_returned_unretried() {
    // The daemon may have read and run the request before its pipe closed.
    let (outcome, attempts) = reset_then_served();
    assert_eq!((outcome.expect_err("not retried").kind(), attempts), (io::ErrorKind::ConnectionReset, 1));
}
