//! The engine's end of the release helper: it starts the helper once, in its own process group so
//! a group kill of the engine does not take it, and writes the held ledger to it whenever the list
//! changes. The engine dying closes the pipe, which is the helper's signal.

use std::io::Write;
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};

use omo_computer_core::holds::Held;
use serde_json::Value;

use super::release::to_wire;

pub struct ReleaseLink {
    _child: Child,
    pipe: ChildStdin,
    last: Vec<Value>,
}

impl ReleaseLink {
    /// Starts `<this binary> --release-helper` with the engine's environment.
    ///
    /// # Errors
    /// The helper could not be started.
    pub fn spawn() -> std::io::Result<Self> {
        let mut child = Command::new(std::env::current_exe()?)
            .arg("--release-helper")
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()?;
        let pipe = child.stdin.take().ok_or_else(|| std::io::Error::other("no helper stdin"))?;
        Ok(Self {
            _child: child,
            pipe,
            last: Vec::new(),
        })
    }

    /// Hands the helper the current ledger when it differs from the last one sent.
    pub fn update(&mut self, held: &[Held]) {
        let list: Vec<Value> = held.iter().map(to_wire).collect();
        if list == self.last {
            return;
        }
        let line = Value::Array(list.clone());
        if writeln!(self.pipe, "{line}").and_then(|()| self.pipe.flush()).is_ok() {
            self.last = list;
        }
    }
}
