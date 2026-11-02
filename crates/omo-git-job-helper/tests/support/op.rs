use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use super::debugger::{self, Hit};
use super::pipe::ServerPipe;
use super::process::{self, WATCH};
use super::win::{command_line, creation_time, Owned};
use super::{example, helper_exe, job_name, sddl, unique};

pub enum Launcher {
    Direct,
    /// Through `testkit_run_as_standard` (Medium integrity, Administrators deny-only).
    Standard,
}

/// The test as writer P of one operation: it owns the control pipe and drives the helper's frames.
pub struct Op {
    pub id: String,
    pub pipe: ServerPipe,
    /// The `Command` child, absent when the helper was launched under the test's debugger.
    pub launcher: Option<Child>,
    pub helper: Owned,
    pub helper_pid: u32,
}

/// The `exec` frame (design section 6.1): three length-prefixed UTF-8 fields, cwd, absolute exe, command line.
pub fn exec_frame(cwd: &str, exe: &str, line: &str) -> Vec<u8> {
    let mut frame = b"exec ".to_vec();
    for field in [cwd, exe, line] {
        frame.extend_from_slice(format!("{}:", field.len()).as_bytes());
        frame.extend_from_slice(field.as_bytes());
    }
    frame.push(b'\n');
    frame
}

impl Op {
    /// Creates the control pipe, launches `omo-git-job-helper run --op <id> <extra>` and waits for `joined`.
    pub fn start(extra: &[&str], launcher: Launcher, stdout: Stdio) -> Result<Self, String> {
        Self::start_with_inbound_quota(extra, launcher, stdout, 65536)
    }

    pub fn start_with_inbound_quota(
        extra: &[&str],
        launcher: Launcher,
        stdout: Stdio,
        inbound: u32,
    ) -> Result<Self, String> {
        use std::os::windows::io::AsRawHandle;
        let id = unique("op");
        let medium = matches!(launcher, Launcher::Standard).then(sddl::medium_user_sddl);
        let mut pipe = ServerPipe::create_with_inbound_quota(
            &format!("omo-git-op-{id}"),
            medium.as_deref(),
            true,
            inbound,
        )
        .map_err(|error| format!("CreateNamedPipeW {error}"))?;
        let helper = helper_exe();
        let mut command = match launcher {
            Launcher::Direct => Command::new(&helper),
            Launcher::Standard => {
                let mut command = Command::new(example("testkit_run_as_standard"));
                command.arg("--").arg(&helper);
                command
            }
        };
        command
            .args(["run", "--op", &id])
            .args(extra)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(Stdio::inherit());
        let mut child = command
            .spawn()
            .map_err(|error| format!("spawn helper: {error}"))?;
        let joined = pipe
            .accept(Duration::from_secs(10), Some(child.as_raw_handle()))
            .map_err(|error| format!("helper never connected to its control pipe: {error}"))
            .and_then(|()| {
                pipe.read_line(Duration::from_secs(10))
                    .map_err(|error| format!("no joined frame: {error}"))
            });
        let joined = match joined {
            Ok(line) => line,
            Err(error) => {
                let code = child
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|status| status.code());
                let _reaped = child.kill().and_then(|()| child.wait());
                return Err(format!("{error} (launcher exit {code:?})"));
            }
        };
        let (helper, helper_pid) = Self::verify_joined(&joined)?;
        Ok(Self {
            id,
            pipe,
            launcher: Some(child),
            helper,
            helper_pid,
        })
    }

    /// Checks a `joined <pid> <ft>` frame against the live process and opens a watch handle on it.
    fn verify_joined(joined: &str) -> Result<(Owned, u32), String> {
        let fields: Vec<&str> = joined.split(' ').collect();
        let ["joined", pid, created] = fields.as_slice() else {
            return Err(format!("expected joined, got {joined:?}"));
        };
        let (pid, created) = (
            pid.parse::<u32>().map_err(|_| joined.to_owned())?,
            created.parse::<u64>().map_err(|_| joined.to_owned())?,
        );
        let helper =
            process::open(pid, WATCH).ok_or_else(|| format!("cannot open helper pid {pid}"))?;
        if creation_time(helper.raw()) != Some(created) {
            return Err(format!(
                "joined identity {joined:?} does not match the live process"
            ));
        }
        Ok((helper, pid))
    }

    /// Launches `run --op <id>` under this thread as debugger, stops it at its first call into kernel32!`export`
    /// (see `debugger`), runs `on_hit` there, detaches, and returns the op with the helper's first frame.
    /// A first frame that is not `joined` is returned as-is with no handshake check.
    pub fn start_debugged(
        export: &str,
        on_hit: impl FnOnce(&Hit<'_>),
    ) -> Result<(Self, String), String> {
        let id = unique("op");
        let mut pipe = ServerPipe::create(&format!("omo-git-op-{id}"), None, true)
            .map_err(|error| format!("CreateNamedPipeW {error}"))?;
        // This thread is the debugger, so the writer side runs on its own thread meanwhile.
        let writer = std::thread::spawn(move || {
            pipe.accept(Duration::from_secs(60), None)?;
            let first = pipe.read_line(Duration::from_secs(60))?;
            Ok::<_, String>((pipe, first))
        });
        let (helper, helper_pid) =
            debugger::run_to_first_call(&helper_exe(), &["run", "--op", &id], export, &id, on_hit)?;
        let (pipe, first) = writer
            .join()
            .map_err(|_| "writer thread panicked".to_owned())??;
        Ok((
            Self {
                id,
                pipe,
                launcher: None,
                helper,
                helper_pid,
            },
            first,
        ))
    }

    pub fn job(&self) -> String {
        job_name(&self.id)
    }

    pub fn exec(&self, cwd: &Path, exe: &Path, args: &[&str]) -> Result<(), String> {
        let exe_text = exe.to_string_lossy();
        let mut line_args = vec![exe_text.as_ref()];
        line_args.extend_from_slice(args);
        self.pipe.write(&exec_frame(
            &cwd.to_string_lossy(),
            &exe_text,
            &command_line(&line_args),
        ))
    }

    /// Sends `exec` then `go` and returns the helper's next frame (`spawned <pid> <ft>` or `spawn-failed <err>`).
    pub fn go(&mut self, cwd: &Path, exe: &Path, args: &[&str]) -> Result<String, String> {
        self.exec(cwd, exe, args)?;
        self.pipe.write(b"go\n")?;
        self.pipe.read_line(Duration::from_secs(30))
    }

    /// The pid from a `spawned <pid> <ft>` frame.
    pub fn spawned_pid(frame: &str) -> u32 {
        let fields: Vec<&str> = frame.split(' ').collect();
        let ["spawned", pid, _] = fields.as_slice() else {
            panic!("expected spawned, got {frame:?}")
        };
        pid.parse().expect("spawned pid")
    }

    pub fn frame(&mut self, timeout: Duration) -> Result<String, String> {
        self.pipe.read_line(timeout)
    }

    /// Reads frames until one starts with `last`; returns every frame read, the last one included.
    pub fn frames_until(&mut self, last: &str, timeout: Duration) -> Result<Vec<String>, String> {
        let deadline = std::time::Instant::now() + timeout;
        let mut frames = Vec::new();
        loop {
            let frame = self
                .pipe
                .read_line(deadline.saturating_duration_since(std::time::Instant::now()))
                .map_err(|error| format!("{error} after {frames:?}"))?;
            let finished = frame.starts_with(last);
            frames.push(frame);
            if finished {
                return Ok(frames);
            }
        }
    }

    /// Closes the writer's end of the control pipe: the helper reads EOF.
    pub fn disconnect(&self) {
        // SAFETY: the server handle is live; disconnecting breaks the client's end.
        unsafe { windows_sys::Win32::System::Pipes::DisconnectNamedPipe(self.pipe.raw()) };
    }

    pub fn kill(&self) {
        process::terminate(self.helper.raw());
    }

    pub fn exited_within(&self, bound: Duration) -> Option<u32> {
        process::signaled_within(self.helper.raw(), bound)
            .then(|| process::exit_code(self.helper.raw()))
            .flatten()
    }
}

impl Drop for Op {
    fn drop(&mut self) {
        process::terminate(self.helper.raw());
        if let Some(launcher) = self.launcher.as_mut() {
            let _reaped = launcher.kill().and_then(|()| launcher.wait());
        }
    }
}
