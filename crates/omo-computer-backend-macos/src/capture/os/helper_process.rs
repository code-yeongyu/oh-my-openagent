//! The persistent capture helper process: `omo-computer-capture-helper` beside the engine
//! (or `OMO_COMPUTER_CAPTURE_HELPER`), started on first use and restarted when it exited.

use std::io::BufReader;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use crate::capture::helper::LineHelper;
use crate::capture::seam::CaptureHelper;
use crate::capture::types::CaptureFault;

pub const HELPER_NAME: &str = "omo-computer-capture-helper";
pub const HELPER_ENV: &str = "OMO_COMPUTER_CAPTURE_HELPER";

type Pipe = LineHelper<BufReader<ChildStdout>, ChildStdin>;

/// The running helper and its pipe.
#[derive(Default)]
pub struct HelperProcess {
    running: Option<(Child, Pipe)>,
}

fn path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(HELPER_ENV) {
        return Some(PathBuf::from(path));
    }
    let engine = std::env::current_exe().ok()?;
    Some(engine.parent()?.join(HELPER_NAME))
}

impl HelperProcess {
    /// The helper's pipe, (re)starting it when needed.
    ///
    /// # Errors
    /// [`CaptureFault::HelperGone`] when it cannot be started.
    pub fn pipe(&mut self) -> Result<&mut dyn CaptureHelper, CaptureFault> {
        let exited = self
            .running
            .as_mut()
            .is_none_or(|(child, _)| !matches!(child.try_wait(), Ok(None)));
        if exited {
            self.running = None;
            let mut child = Command::new(path().ok_or(CaptureFault::HelperGone)?)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| CaptureFault::HelperGone)?;
            let stdin = child.stdin.take().ok_or(CaptureFault::HelperGone)?;
            let stdout = child.stdout.take().ok_or(CaptureFault::HelperGone)?;
            self.running = Some((child, LineHelper::new(BufReader::new(stdout), stdin)));
        }
        let (_, pipe) = self.running.as_mut().ok_or(CaptureFault::HelperGone)?;
        Ok(pipe)
    }
}

impl Drop for HelperProcess {
    fn drop(&mut self) {
        if let Some((mut child, pipe)) = self.running.take() {
            drop(pipe); // closing stdin ends the helper's read loop
            let _ = child.wait();
        }
    }
}
