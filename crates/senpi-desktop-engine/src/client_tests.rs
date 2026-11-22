use std::io::Read;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::os::unix::net::UnixListener;
use std::path::PathBuf;

use serde_json::json;

use super::{connect_checked, exchange_or_start, exchange_over};
use crate::peer::{euid, is_refusal};

fn private_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("senpi-client-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::DirBuilder::new().mode(0o700).create(&dir).expect("private dir");
    dir
}

/// The bytes a server reads from one client before that client closes.
fn bytes_received(dir: &std::path::Path, lookup: fn(i32) -> std::io::Result<u32>) -> (std::io::Error, usize) {
    let socket = dir.join("e.sock");
    let listener = UnixListener::bind(&socket).expect("bind");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept");
        let mut received = Vec::new();
        stream.read_to_end(&mut received).expect("read until the client closes");
        received.len()
    });
    let refused = connect_checked(socket.to_str().expect("utf-8"), lookup).expect_err("refused");
    (refused, server.join().expect("server thread"))
}

#[test]
fn t25_25_a_socket_served_by_another_euid_is_closed_before_any_byte() {
    // Given
    let dir = private_dir("other-euid");
    // When
    let (refused, received) = bytes_received(&dir, |_| Ok(euid().wrapping_add(1)));
    // Then
    assert!(is_refusal(&refused), "{refused}");
    assert_eq!(received, 0);
    std::fs::remove_dir_all(&dir).expect("cleanup");
}

#[test]
fn t25_25_a_failed_server_credential_lookup_is_closed_before_any_byte() {
    // Given
    let dir = private_dir("lookup-fails");
    // When
    let (refused, received) = bytes_received(&dir, |_| Err(std::io::Error::other("no credentials")));
    // Then
    assert!(is_refusal(&refused), "{refused}");
    assert_eq!(received, 0);
    std::fs::remove_dir_all(&dir).expect("cleanup");
}

#[test]
fn another_clients_notification_before_the_reply_is_skipped() {
    // Given: the shared session fans a notification out before this client's reply.
    let (client, mut daemon) = std::os::unix::net::UnixStream::pair().expect("socket pair");
    let server = std::thread::spawn(move || {
        let mut request = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(&daemon), &mut request).expect("request");
        std::io::Write::write_all(
            &mut daemon,
            b"{\"jsonrpc\":\"2.0\",\"method\":\"stopPath.changed\",\"params\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":7}\n",
        )
        .expect("lines written");
    });
    // When
    let reply = exchange_over(client, &json!({"jsonrpc": "2.0", "id": 1, "method": "displays"})).expect("reply");
    // Then
    assert_eq!(reply, json!({"jsonrpc": "2.0", "id": 1, "result": 7}));
    server.join().expect("server thread");
}

/// A daemon end that fails the write or read with `kind`, after `reply` bytes.
struct Failing {
    reply: std::io::Cursor<Vec<u8>>,
    write: Option<std::io::ErrorKind>,
    read: std::io::ErrorKind,
}

impl Read for Failing {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self.reply.read(buf)? {
            0 => Err(self.read.into()),
            read => Ok(read),
        }
    }
}

impl std::io::Write for Failing {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.write.map_or(Ok(buf.len()), |kind| Err(kind.into()))
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Runs the retried exchange over `ends` in order; returns the outcome and the attempts used.
fn exchange_over_ends(ends: Vec<Failing>) -> (std::io::Result<serde_json::Value>, usize) {
    let mut ends = ends.into_iter();
    let mut attempts = 0;
    let outcome = super::retry_reset_once(|| {
        attempts += 1;
        exchange_over(ends.next().expect("an end per attempt"), &json!({"id": 1}))
    });
    (outcome, attempts)
}

fn end(reply: &str, write: Option<std::io::ErrorKind>, read: std::io::ErrorKind) -> Failing {
    Failing { reply: std::io::Cursor::new(reply.as_bytes().to_vec()), write, read }
}

#[test]
fn t25_24_the_reset_retry_happens_once_and_only_before_a_reply_byte() {
    use std::io::ErrorKind::{BrokenPipe, ConnectionReset, UnexpectedEof};
    let replied = || end("{\"id\":1,\"result\":1}\n", None, UnexpectedEof);
    // A broken pipe on the write, then a served retry.
    let (outcome, attempts) = exchange_over_ends(vec![end("", Some(BrokenPipe), UnexpectedEof), replied()]);
    assert_eq!((outcome.expect("retried")["result"].clone(), attempts), (json!(1), 2));
    // Two resets: the second is returned, no third attempt.
    let reset = || end("", None, ConnectionReset);
    let (outcome, attempts) = exchange_over_ends(vec![reset(), reset(), replied()]);
    assert_eq!((outcome.expect_err("second reset").kind(), attempts), (ConnectionReset, 2));
    // A reset after a notification byte: the request may have run, so it is not retried.
    let late = end("{\"method\":\"stopPath.changed\"}\n", None, ConnectionReset);
    let (outcome, attempts) = exchange_over_ends(vec![late, replied()]);
    assert_eq!((outcome.expect_err("late reset").kind(), attempts), (ConnectionReset, 1));
}

#[test]
fn a_close_before_the_reply_is_not_retried() {
    // Given: a daemon that read the request and closed without a reset.
    let (client, daemon) = std::os::unix::net::UnixStream::pair().expect("socket pair");
    let server = std::thread::spawn(move || {
        let mut request = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(&daemon), &mut request).expect("request");
    });
    let mut attempts = 0;
    let mut client = Some(client);
    // When
    let outcome = super::retry_reset_once(|| {
        attempts += 1;
        exchange_over(client.take().expect("one connection"), &json!({"id": 1}))
    });
    // Then
    assert_eq!(outcome.expect_err("closed").kind(), std::io::ErrorKind::UnexpectedEof);
    assert_eq!(attempts, 1);
    server.join().expect("server thread");
}

/// Accepts one client and waits, without reading, until its request has arrived.
#[cfg(target_os = "linux")]
fn accept_with_request(listener: &UnixListener) -> std::os::unix::net::UnixStream {
    use std::os::fd::AsRawFd;

    let (stream, _) = listener.accept().expect("accept");
    let mut byte = [0_u8; 1];
    // SAFETY: `stream` is an open socket and `byte` is a writable one-byte buffer.
    let peeked = unsafe { libc::recv(stream.as_raw_fd(), byte.as_mut_ptr().cast(), 1, libc::MSG_PEEK) };
    assert_eq!(peeked, 1, "the request arrived");
    stream
}

/// T25-24: the daemon's listener closes with this client's connection still
/// unaccepted, which the kernel reports as a reset before any reply byte.
#[cfg(target_os = "linux")]
#[test]
fn t25_24_a_reset_before_the_first_reply_byte_is_retried_once() {
    // Given: a first daemon that closes the connection with the request unread, then a successor.
    let dir = private_dir("reset-retry");
    let socket = dir.join("e.sock");
    let first = UnixListener::bind(&socket).expect("bind");
    let path = socket.clone();
    let server = std::thread::spawn(move || {
        let unanswered = accept_with_request(&first);
        std::fs::remove_file(&path).expect("unlink");
        let successor = UnixListener::bind(&path).expect("rebind");
        drop((first, unanswered));
        let (answered, _) = successor.accept().expect("the retry connects");
        let mut request = String::new();
        std::io::BufRead::read_line(&mut std::io::BufReader::new(&answered), &mut request).expect("request");
        std::io::Write::write_all(&mut &answered, b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"retried\"}\n")
            .expect("reply");
        request
    });
    // When
    let reply = super::exchange(socket.to_str().expect("utf-8"), &json!({"jsonrpc": "2.0", "id": 1, "method": "displays"}));
    // Then
    let reply = reply.expect("the retry is answered");
    assert_eq!(reply["result"], json!("retried"));
    assert!(server.join().expect("server thread").contains("displays"));
    std::fs::remove_dir_all(&dir).expect("cleanup");
}

#[cfg(target_os = "linux")]
#[test]
fn t25_24_a_reset_after_a_reply_byte_is_not_retried() {
    // Given: a daemon that writes a notification, then closes with the request unread.
    let dir = private_dir("reset-late");
    let socket = dir.join("e.sock");
    let listener = UnixListener::bind(&socket).expect("bind");
    let server = std::thread::spawn(move || {
        let stream = accept_with_request(&listener);
        std::io::Write::write_all(&mut &stream, b"{\"jsonrpc\":\"2.0\",\"method\":\"stopPath.changed\",\"params\":{}}\n")
            .expect("notification");
        drop(stream);
        listener
    });
    // When
    let failed = super::exchange(socket.to_str().expect("utf-8"), &json!({"jsonrpc": "2.0", "id": 1, "method": "click"}));
    // Then: the error is returned and nothing connected again.
    let failed = failed.expect_err("a reset after a reply byte is an error");
    assert_eq!(failed.kind(), std::io::ErrorKind::ConnectionReset, "{failed}");
    let listener = server.join().expect("server thread");
    listener.set_nonblocking(true).expect("nonblocking");
    assert_eq!(listener.accept().map(drop).map_err(|error| error.kind()), Err(std::io::ErrorKind::WouldBlock));
    std::fs::remove_dir_all(&dir).expect("cleanup");
}

#[test]
fn t25_17_a_loose_endpoint_directory_is_refused_without_an_auto_start() {
    // Given: a directory group and other can enter.
    let dir = private_dir("loose");
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let socket = dir.join("e.sock");
    // When
    let refused = exchange_or_start(socket.to_str().expect("utf-8"), &[], &json!({"id": 1}))
        .expect_err("refused");
    // Then
    assert!(is_refusal(&refused), "{refused}");
    assert!(!socket.exists(), "no daemon was started");
    std::fs::remove_dir_all(&dir).expect("cleanup");
}
