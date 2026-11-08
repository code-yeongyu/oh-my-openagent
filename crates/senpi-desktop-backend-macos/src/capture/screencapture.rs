//! One `/usr/sbin/screencapture` run into a temporary PNG, with the OMP
//! permission-vs-capture-failed classification.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use image::{DynamicImage, RgbaImage};
use senpi_desktop_core::error::DesktopError;
use senpi_desktop_core::types::DesktopDisplay;

use super::{capture_permission, permission_denied};

const SCREENCAPTURE_PATH: &str = "/usr/sbin/screencapture";
const CAPTURE_DEADLINE: Duration = Duration::from_secs(5);
const POLL_INTERVAL: Duration = Duration::from_millis(10);

/// Why a `screencapture` run produced no image.
#[derive(Debug)]
pub(crate) enum ShotError {
    /// The binary is absent, or it exited non-zero while Screen Recording is
    /// granted: the display-only CoreGraphics fallback may run.
    Unavailable(String),
    /// Permission denied, deadline, wait, or decode failure: no fallback.
    Fatal(DesktopError),
}

impl From<ShotError> for DesktopError {
    fn from(error: ShotError) -> Self {
        match error {
            ShotError::Unavailable(reason) => Self::capture_failed(reason),
            ShotError::Fatal(error) => error,
        }
    }
}

/// Runs `screencapture`. The program, deadline, and permission probe are
/// injectable so tests drive every classification branch with a real process.
#[derive(Debug, Clone)]
pub(crate) struct Screencapture {
    program: PathBuf,
    deadline: Duration,
    permission: fn() -> bool,
}

impl Screencapture {
    pub(crate) fn system() -> Self {
        Self {
            program: PathBuf::from(SCREENCAPTURE_PATH),
            deadline: CAPTURE_DEADLINE,
            permission: capture_permission,
        }
    }

    #[cfg(test)]
    pub(crate) fn with(program: PathBuf, deadline: Duration, permission: fn() -> bool) -> Self {
        Self {
            program,
            deadline,
            permission,
        }
    }

    pub(crate) fn permission_granted(&self) -> bool {
        (self.permission)()
    }

    /// Captures into a fresh `senpi-desktop-*.png` and decodes it as RGBA.
    pub(crate) fn run(&self, args: &[String]) -> Result<RgbaImage, ShotError> {
        let file = tempfile::Builder::new()
            .prefix("senpi-desktop-")
            .suffix(".png")
            .tempfile()
            .map_err(|error| fatal(format!("failed to create temporary screenshot file: {error}")))?;
        let status = self.exit_status(args, file.path())?;
        if !status.success() {
            return Err(if self.permission_granted() {
                ShotError::Unavailable(format!("macOS screen capture exited with {status}"))
            } else {
                ShotError::Fatal(permission_denied())
            });
        }
        image::open(file.path())
            .map(DynamicImage::into_rgba8)
            .map_err(|error| fatal(format!("failed to decode macOS screenshot: {error}")))
    }

    fn exit_status(&self, args: &[String], output: &Path) -> Result<ExitStatus, ShotError> {
        let mut child = match Command::new(&self.program)
            .args(args)
            .arg(output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(ShotError::Unavailable(format!(
                    "{} is absent: {error}",
                    self.program.display()
                )));
            }
            Err(error) => return Err(fatal(format!("failed to start macOS screen capture: {error}"))),
        };
        let deadline = Instant::now() + self.deadline;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => return Ok(status),
                Ok(None) if Instant::now() >= deadline => {
                    reap(&mut child);
                    return Err(fatal(format!(
                        "macOS screen capture exceeded its {} ms deadline",
                        self.deadline.as_millis()
                    )));
                }
                Ok(None) => thread::sleep(POLL_INTERVAL),
                Err(error) => {
                    reap(&mut child);
                    return Err(fatal(format!(
                        "failed while waiting for macOS screen capture: {error}"
                    )));
                }
            }
        }
    }
}

/// `-R<x,y,w,h>`: one display's logical rect in global coordinates.
pub(crate) fn display_rect_arg(display: &DesktopDisplay) -> String {
    format!(
        "-R{},{},{},{}",
        display.x, display.y, display.width, display.height
    )
}

/// Arguments for a silent (`-x`) display-rect capture.
pub(crate) fn display_args(display: &DesktopDisplay) -> [String; 2] {
    ["-x".to_string(), display_rect_arg(display)]
}

/// Arguments for a silent, shadowless (`-o`) capture of one window id (`-l`).
pub(crate) fn window_args(window_id: u32) -> [String; 4] {
    [
        "-x".to_string(),
        "-o".to_string(),
        "-l".to_string(),
        window_id.to_string(),
    ]
}

fn fatal(message: impl Into<String>) -> ShotError {
    ShotError::Fatal(DesktopError::capture_failed(message))
}

fn reap(child: &mut Child) {
    if let Err(error) = child.kill().and_then(|()| child.wait().map(drop)) {
        eprintln!("senpi-desktop-backend-macos: capture: screencapture reap failed error={error}");
    }
}
