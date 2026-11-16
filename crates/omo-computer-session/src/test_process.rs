//! Test-only: this test binary re-invoked as a child that plays one role (holds a lock,
//! appends audit lines) and reports each step as a line on its stdout. Every wait is bounded
//! by `BOUND`; nothing waits on a fixed sleep. A child still running when its `Player` drops
//! is killed and reaped, so a failing test leaves no process behind.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

const ROLE: &str = "OMO_SESSION_TEST_ROLE";
const DIR: &str = "OMO_SESSION_TEST_DIR";
const BOUND: Duration = Duration::from_secs(60);

/// The directory a parent test handed this process, when it started it to play `role`.
pub(crate) fn playing(role: &str) -> Option<PathBuf> {
    if std::env::var(ROLE).ok()? != role {
        return None;
    }
    std::env::var_os(DIR).map(PathBuf::from)
}

/// Blocks until the parent closes this child's stdin.
pub(crate) fn until_released() {
    let mut rest = String::new();
    while std::io::stdin()
        .read_line(&mut rest)
        .is_ok_and(|read| read > 0)
    {
        rest.clear();
    }
}

/// The command that re-runs exactly the test `path` (a `module_path!()`-style path) as `role`.
pub(crate) fn command(path: &str, role: &str, dir: &Path) -> Command {
    let name = path.split_once("::").map_or(path, |(_, rest)| rest);
    let mut command = Command::new(std::env::current_exe().expect("the test binary"));
    command
        .args([name, "--exact", "--nocapture", "--test-threads=1"])
        .env(ROLE, role)
        .env(DIR, dir);
    command
}

/// A child playing a role, with its stdout read line by line.
pub(crate) struct Player {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    lines: Receiver<String>,
}

impl Player {
    pub(crate) fn spawn(path: &str, role: &str, dir: &Path) -> Self {
        let mut child = command(path, role, dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn the child");
        let stdout = child.stdout.take().expect("the child's stdout");
        let (send, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if send.send(line).is_err() {
                    break;
                }
            }
        });
        Self {
            stdin: child.stdin.take(),
            child: Some(child),
            lines,
        }
    }

    /// Waits for a line ending in each of `sentinels`, in any order (libtest may print the
    /// test's name before a child's first line).
    pub(crate) fn wait_for(&self, sentinels: &[&str]) {
        let deadline = Instant::now() + BOUND;
        let mut missing: Vec<&str> = sentinels.to_vec();
        while !missing.is_empty() {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.lines.recv_timeout(left) {
                Ok(line) => missing.retain(|sentinel| !line.trim_end().ends_with(sentinel)),
                Err(error) => panic!("the child never printed {missing:?}: {error}"),
            }
        }
    }

    /// Closes the child's stdin: a child in `until_released` goes on.
    pub(crate) fn release(&mut self) {
        drop(self.stdin.take());
    }

    pub(crate) fn kill(&mut self) {
        if let Some(child) = self.child.as_mut() {
            child.kill().expect("kill the child");
        }
    }

    /// The child's exit status, waited for with a bound.
    pub(crate) fn exited(&mut self) -> ExitStatus {
        let mut child = self.child.take().expect("a running child");
        within("the child's exit", move || child.wait().expect("wait"))
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.release();
        if let Some(mut child) = self.child.take() {
            if child.kill().is_ok() {
                let _reaped = child.wait();
            }
        }
    }
}

/// `work` on its own thread, failing the test when it has not finished within `BOUND`.
pub(crate) fn within<T: Send + 'static>(
    what: &str,
    work: impl FnOnce() -> T + Send + 'static,
) -> T {
    let (send, done) = mpsc::channel();
    std::thread::spawn(move || {
        let _receiver_gone = send.send(work());
    });
    done.recv_timeout(BOUND)
        .unwrap_or_else(|error| panic!("{what} did not finish within {BOUND:?}: {error}"))
}
