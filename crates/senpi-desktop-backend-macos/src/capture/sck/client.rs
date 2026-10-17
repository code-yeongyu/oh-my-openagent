//! One persistent helper process: framed, bounded reads on a nonblocking
//! pipe, deadline-aware, and reset on any transport failure.

use std::io::{self, BufRead, BufReader, BufWriter, Read, Write};
use std::os::fd::AsRawFd;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::MAX_COMPOSITE_PIXELS;

use super::frame::{decode, frame_bytes, Frame};
use super::protocol::{Batch, Reply, TargetRequest};

/// Test-only deadline for `capture`. The wire tests' fake helpers are Python scripts whose
/// interpreter start alone can take over 5 s on a loaded host, and none of those tests is about
/// timing; deadline behaviour is tested through `ping` and `capture_within` with explicit budgets.
#[cfg(test)]
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);
/// The warm-up ping's own line; the helper answers `{"kind":"ready"}`.
const PING: &[u8] = b"{\"kind\":\"ping\"}\n";
const HEADER_LIMIT: usize = 65_536;

/// Whether a failure leaves the request/reply stream synchronized.
#[derive(Debug)]
pub(crate) enum ClientError {
    Transport(DesktopError),
    Reply(DesktopError),
}

impl From<DesktopError> for ClientError {
    fn from(error: DesktopError) -> Self {
        Self::Transport(error)
    }
}

/// One helper child and its pipe ends. `Drop` reaps the child.
pub(crate) struct HelperClient {
    child: Child,
    input: BufWriter<ChildStdin>,
    output: BufReader<ChildStdout>,
    header: Vec<u8>,
    /// Whether the helper has written any reply byte. A transport failure
    /// before that is a start failure (silent fallback); after it, a capture
    /// failure the caller sees, so a helper crashing on one target is not hidden.
    pub(crate) has_replied: bool,
    /// Temp dir the staged helper binary lives in; kept alive until drop.
    _staging: Option<tempfile::TempDir>,
}

impl HelperClient {
    /// Spawns `program`, which must speak the helper wire protocol.
    pub(crate) fn start(program: &PathBuf) -> CoreResult<Self> {
        Self::start_with_staging(program, None)
    }

    pub(crate) fn start_with_staging(
        program: &PathBuf,
        staging: Option<tempfile::TempDir>,
    ) -> CoreResult<Self> {
        let mut child = Command::new(program)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                DesktopError::capture_failed(format!(
                    "cannot start the native capture worker: {error}"
                ))
            })?;
        let (Some(input), Some(output)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DesktopError::internal("capture worker pipes are missing"));
        };
        let fd = output.as_raw_fd();
        // SAFETY: `output` owns this live descriptor; nonblocking reads let
        // every pipe wait honor the capture deadline.
        let configured = unsafe {
            let flags = libc::fcntl(fd, libc::F_GETFL);
            flags >= 0 && libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) == 0
        };
        if !configured {
            let error = io_error(io::Error::last_os_error());
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        Ok(Self {
            child,
            input: BufWriter::new(input),
            output: BufReader::new(output),
            header: Vec::new(),
            has_replied: false,
            _staging: staging,
        })
    }

    /// Sends one batch and reads one frame per request. A reply-level error
    /// (PermissionDenied, WindowNotFound, CaptureUnavailable...) does NOT
    /// poison the worker; a transport error leaves it for the owner to reset.
    #[cfg(test)]
    pub(crate) fn capture(
        &mut self,
        requests: &[TargetRequest],
    ) -> Result<Vec<Frame>, ClientError> {
        self.capture_within(requests, CAPTURE_TIMEOUT)
    }

    /// Waits until the helper has started and fetched shareable content once,
    /// so the first capture does not pay the cold start. A helper that does
    /// not answer within `budget` is a transport failure (a start failure).
    pub(crate) fn ping(&mut self, budget: Duration) -> Result<(), ClientError> {
        let deadline = Instant::now() + budget;
        self.input.write_all(PING).map_err(io_error)?;
        self.input.flush().map_err(io_error)?;
        let reply = read_header(&mut self.output, &mut self.header, deadline)?;
        self.has_replied = true;
        match reply {
            Reply::Ready => Ok(()),
            Reply::Error { error, .. } => Err(ClientError::Transport(DesktopError::capture_failed(
                format!("capture worker refused the warm-up ping: {error}"),
            ))),
            Reply::Frame { .. } => Err(ClientError::Transport(DesktopError::capture_failed(
                "capture worker answered the warm-up ping with a frame",
            ))),
        }
    }

    /// `capture` with an explicit deadline for the whole batch.
    pub(crate) fn capture_within(
        &mut self,
        requests: &[TargetRequest],
        budget: Duration,
    ) -> Result<Vec<Frame>, ClientError> {
        let deadline = Instant::now() + budget;
        serde_json::to_writer(
            &mut self.input,
            &Batch {
                requests,
                max_pixels: MAX_COMPOSITE_PIXELS,
            },
        )
        .map_err(|error| {
            DesktopError::internal(format!("cannot encode capture request: {error}"))
        })?;
        self.input.write_all(b"\n").map_err(io_error)?;
        self.input.flush().map_err(io_error)?;
        let mut frames = Vec::with_capacity(requests.len());
        for expected in 0..requests.len() {
            let reply = match read_header(&mut self.output, &mut self.header, deadline) {
                Ok(reply) => reply,
                Err(error) => {
                    // Any header byte proves the helper started; only a silent
                    // death counts as a start failure (see `has_replied`).
                    self.has_replied |= !self.header.is_empty();
                    return Err(error.into());
                },
            };
            self.has_replied = true;
            match reply {
                Reply::Ready => {
                    return Err(DesktopError::capture_failed(
                        "capture worker sent a warm-up reply to a capture request",
                    )
                    .into());
                },
                Reply::Error { code, error, reason } => {
                    return Err(ClientError::Reply(match (code.as_str(), reason) {
                        ("PermissionDenied", _) => super::super::permission_denied(),
                        ("WindowNotFound", _) => DesktopError::window_not_found(error),
                        ("InvalidTarget", _) => DesktopError::invalid_target(error),
                        ("Unsupported", _) => DesktopError::internal(format!(
                            "capture worker reported Unsupported on macOS 14+: {error}"
                        )),
                        ("CaptureUnavailable", Some(reason)) => {
                            DesktopError::capture_unavailable(reason, error)
                        },
                        ("CaptureUnavailable", None) => DesktopError::capture_failed(format!(
                            "capture worker sent CaptureUnavailable without a reason: {error}"
                        )),
                        _ => DesktopError::capture_failed(error),
                    }));
                },
                Reply::Frame {
                    index,
                    width,
                    height,
                    byte_length,
                    bounds,
                    is_on_screen,
                    pid,
                } => {
                    if index != expected || !bounds.valid() {
                        return Err(DesktopError::capture_failed(
                            "capture worker returned inconsistent frame metadata",
                        )
                        .into());
                    }
                    if frame_bytes(width, height)? != byte_length {
                        return Err(DesktopError::capture_failed(
                            "capture worker returned inconsistent frame metadata",
                        )
                        .into());
                    }
                    let pixels = read_pixels(&mut self.output, byte_length, deadline)?;
                    let mut frame = decode(
                        width,
                        height,
                        byte_length,
                        pixels,
                        (bounds.x, bounds.y, bounds.width, bounds.height),
                        is_on_screen,
                    )?;
                    frame.pid = pid.filter(|pid| *pid > 0);
                    frames.push(frame);
                },
            }
        }
        Ok(frames)
    }
}

impl Drop for HelperClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn check_deadline(deadline: Instant) -> CoreResult<()> {
    if Instant::now() >= deadline {
        return Err(DesktopError::timeout(
            "ScreenCaptureKit worker exceeded its deadline",
        ));
    }
    Ok(())
}

fn wait_readable(output: &BufReader<ChildStdout>, deadline: Instant) -> CoreResult<()> {
    check_deadline(deadline)?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    let milliseconds = i32::try_from(remaining.as_millis().min(20)).unwrap_or(20).max(1);
    let mut descriptor = libc::pollfd {
        fd: output.get_ref().as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    // SAFETY: one initialized pollfd points at the reader's live descriptor.
    let result = unsafe { libc::poll(&mut descriptor, 1, milliseconds) };
    if result < 0 {
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(io_error(error));
        }
    }
    Ok(())
}

fn read_header(
    output: &mut BufReader<ChildStdout>,
    header: &mut Vec<u8>,
    deadline: Instant,
) -> CoreResult<Reply> {
    header.clear();
    loop {
        check_deadline(deadline)?;
        let remaining = (HEADER_LIMIT + 1).saturating_sub(header.len());
        let result = output.by_ref().take(remaining as u64).read_until(b'\n', header);
        if header.len() > HEADER_LIMIT {
            return Err(DesktopError::capture_failed(
                "native capture header exceeds its safety limit",
            ));
        }
        match result {
            Ok(0) => {
                return Err(DesktopError::capture_failed(
                    "native capture worker exited before returning a frame",
                ));
            },
            Ok(_) if header.last() == Some(&b'\n') => break,
            Ok(_) => {},
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {},
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_readable(output, deadline)?;
            },
            Err(error) => return Err(io_error(error)),
        }
    }
    serde_json::from_slice(header).map_err(|error| {
        DesktopError::capture_failed(format!("invalid native capture response: {error}"))
    })
}

fn read_pixels(
    output: &mut BufReader<ChildStdout>,
    length: usize,
    deadline: Instant,
) -> CoreResult<Vec<u8>> {
    let mut pixels = Vec::with_capacity(length);
    while pixels.len() < length {
        check_deadline(deadline)?;
        let remaining = (length - pixels.len()).min(256 * 1024);
        match output.by_ref().take(remaining as u64).read_to_end(&mut pixels) {
            Ok(0) => {
                return Err(DesktopError::capture_failed(
                    "native capture worker returned a truncated image",
                ));
            },
            Ok(_) => {},
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {},
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                wait_readable(output, deadline)?;
            },
            Err(error) => return Err(io_error(error)),
        }
    }
    Ok(pixels)
}

fn io_error(error: io::Error) -> DesktopError {
    DesktopError::capture_failed(format!("native capture transport failed: {error}"))
}
