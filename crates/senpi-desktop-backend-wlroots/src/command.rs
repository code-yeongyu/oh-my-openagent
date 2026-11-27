//! The subprocess seam: `grim` capture and `wtype` input run through one
//! runner the tests fake, so no test spawns a real compositor tool.

use std::process::{Command, Stdio};

/// Why a tool invocation did not produce stdout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunFailure {
    /// The program is not installed or cannot be executed.
    Spawn(String),
    /// The program ran and exited non-zero; `stderr` is its complaint.
    Exit {
        program: String,
        code: i32,
        stderr: String,
    },
}

impl RunFailure {
    pub fn message(&self) -> String {
        match self {
            Self::Spawn(program) => {
                format!("{program} is not available: {program} failed to start or is not installed")
            }
            Self::Exit {
                program,
                code,
                stderr,
            } => {
                let stderr = stderr.trim();
                if stderr.is_empty() {
                    format!("{program} exited with status {code}")
                } else {
                    format!("{program} exited with status {code}: {stderr}")
                }
            }
        }
    }

    /// The program itself was missing, as opposed to running and failing.
    #[must_use]
    pub fn is_spawn(&self) -> bool {
        matches!(self, Self::Spawn(_))
    }
}

/// One spawned tool process the caller can poll, stop and join.
pub trait SpawnedChild: Send {
    /// `None` while the process runs; `Some(exit code)` once it is gone.
    ///
    /// # Errors
    /// The process state could not be read.
    fn try_wait(&mut self) -> std::io::Result<Option<i32>>;

    /// Stops the process and waits for it, so the compositor's
    /// destroy-on-close releases whatever it held.
    fn kill(&mut self);
}

/// A real child process, stdin closed so a tool reading it sees EOF.
pub struct ProcessChild {
    child: std::process::Child,
}

impl ProcessChild {
    /// # Errors
    /// [`RunFailure::Spawn`] when `program` cannot start.
    pub fn spawn(program: &str, args: &[String]) -> Result<Self, RunFailure> {
        let child = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                RunFailure::Spawn(if error.kind() == std::io::ErrorKind::NotFound {
                    program.to_owned()
                } else {
                    format!("{program}: {error}")
                })
            })?;
        Ok(Self { child })
    }
}

impl SpawnedChild for ProcessChild {
    fn try_wait(&mut self) -> std::io::Result<Option<i32>> {
        Ok(self
            .child
            .try_wait()?
            .map(|status| status.code().unwrap_or(1)))
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Runs a desktop tool and returns its stdout.
pub trait CommandRunner: Send {
    /// # Errors
    /// [`RunFailure::Spawn`] when `program` cannot run, [`RunFailure::Exit`]
    /// when it exits non-zero.
    fn run(&mut self, program: &str, args: &[String]) -> Result<Vec<u8>, RunFailure>;

    /// Starts `program` without waiting for it, for delivery the caller can
    /// interrupt by killing the child.
    ///
    /// # Errors
    /// [`RunFailure::Spawn`] when `program` cannot start.
    fn spawn(
        &mut self,
        program: &str,
        args: &[String],
    ) -> Result<Box<dyn SpawnedChild>, RunFailure> {
        Ok(Box::new(ProcessChild::spawn(program, args)?))
    }
}

/// Real processes, each with stdin closed so a tool reading it sees EOF
/// instead of blocking.
#[derive(Debug, Default, Clone, Copy)]
pub struct ProcessRunner;

impl CommandRunner for ProcessRunner {
    fn run(&mut self, program: &str, args: &[String]) -> Result<Vec<u8>, RunFailure> {
        let output = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| {
                RunFailure::Spawn(if error.kind() == std::io::ErrorKind::NotFound {
                    program.to_owned()
                } else {
                    format!("{program}: {error}")
                })
            })?;
        if output.status.success() {
            return Ok(output.stdout);
        }
        Err(RunFailure::Exit {
            program: program.to_owned(),
            code: output.status.code().unwrap_or(1),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}
