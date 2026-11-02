use super::{capture_for, open, visible};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

const TEST: &str = "overlay::coordination::tests::two_helpers_cannot_render_inside_another_sessions_capture";

struct Helper {
    child: Child,
    replies: Receiver<String>,
}

impl Helper {
    fn start(path: &Path) -> Self {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture"])
            .env("SENPI_CURSOR_LOCK_FIXTURE", path)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit())
            .spawn().unwrap();
        let output = child.stdout.take().unwrap();
        let (send, replies) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let line = line.unwrap();
                if let Some(reply) = line.strip_prefix("CURSOR_LOCK ") {
                    if send.send(reply.to_owned()).is_err() { break; }
                }
            }
        });
        let helper = Self { child, replies };
        helper.expect("ready");
        helper
    }

    fn expect(&self, expected: &str) {
        assert_eq!(self.replies.recv_timeout(Duration::from_secs(30)).unwrap(), expected);
    }

    fn command(&mut self, command: &str, expected: &str) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{command}").unwrap();
        self.expect(expected);
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        match self.child.kill() {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {}
            Err(error) => panic!("fixture termination failed: {error}"),
        }
        self.child.wait().unwrap();
    }
}

#[test]
fn two_helpers_cannot_render_inside_another_sessions_capture() {
    if let Some(path) = std::env::var_os("SENPI_CURSOR_LOCK_FIXTURE") {
        // A headless child exercises exactly the lock lifetime used around panel render/orderOut.
        let mut shown = None;
        println!("\nCURSOR_LOCK ready");
        for command in std::io::stdin().lock().lines() {
            match command.unwrap().as_str() {
                "show" => {
                    shown = visible(open(Path::new(&path)).unwrap()).unwrap();
                    println!("CURSOR_LOCK {}", if shown.is_some() { "visible" } else { "hidden" });
                }
                "hide" => {
                    drop(shown.take());
                    println!("CURSOR_LOCK hidden");
                }
                command => panic!("unknown fixture command: {command}"),
            }
        }
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("overlay.lock");
    let mut first = Helper::start(&path);
    let mut second = Helper::start(&path);
    first.command("show", "visible");
    second.command("show", "visible");
    assert!(capture_for(open(&path).unwrap(), std::thread::sleep, std::time::Duration::from_secs(2)).is_err());
    first.command("hide", "hidden");
    assert!(capture_for(open(&path).unwrap(), std::thread::sleep, std::time::Duration::from_secs(2)).is_err(), "the other session is still visible");
    second.command("hide", "hidden");
    let pixels = capture_for(open(&path).unwrap(), std::thread::sleep, std::time::Duration::from_secs(2)).unwrap();
    first.command("show", "hidden");
    second.command("show", "hidden");
    drop(pixels);
    first.command("show", "visible");
    second.command("show", "visible");
}
