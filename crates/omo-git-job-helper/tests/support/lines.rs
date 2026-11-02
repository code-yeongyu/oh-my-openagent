use std::io::{BufRead, BufReader, Read};
use std::sync::mpsc::{channel, Receiver};
use std::time::Duration;

/// Lines from a child's stdout, read on a thread so every wait for one is bounded.
pub struct Lines(Receiver<String>);

impl Lines {
    pub fn new(source: impl Read + Send + 'static) -> Self {
        let (send, receive) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(source).lines().map_while(Result::ok) {
                if send.send(line).is_err() {
                    return;
                }
            }
        });
        Self(receive)
    }

    pub fn next(&self, timeout: Duration) -> Option<String> {
        self.0.recv_timeout(timeout).ok()
    }
}

/// Runs a command to completion with stdin bytes, bounded by `timeout`; returns (code, stdout, stderr).
pub fn run_bounded(
    mut command: std::process::Command,
    stdin: &[u8],
    timeout: Duration,
) -> (Option<i32>, String, String) {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn");
    let mut input = child.stdin.take().expect("stdin");
    input.write_all(stdin).expect("write stdin");
    drop(input);
    let (send, receive) = channel();
    std::thread::spawn(move || {
        let output = child.wait_with_output();
        let _ignored = send.send(output);
    });
    let output = receive
        .recv_timeout(timeout)
        .expect("command did not finish within its bound")
        .expect("wait");
    (
        output.status.code(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}
