//! The session-owned ScreenCaptureKit worker: one persistent helper per
//! session thread, reset after a transport failure, with `screencapture`
//! retained as the fallback when the worker is unavailable (macOS < 14, no
//! staged helper, or a helper that cannot start).

mod client;
mod frame;
mod protocol;

#[cfg(test)]
mod tests;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod worker_tests;

use std::cell::RefCell;
use std::path::PathBuf;
use std::time::Duration;

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use self::client::{ClientError, HelperClient};
use self::protocol::TargetRequest;

/// The frame type `MacCapture` composites.
pub(crate) use self::frame::Frame as SckFrame;
#[cfg(test)]
pub(crate) use self::protocol::TargetRequest as SckTargetRequest;

/// A window capture request (off-Space ids resolve; minimized is refused).
pub(crate) fn target_window(id: u32) -> TargetRequest {
    TargetRequest::window(id)
}

/// A display capture request; titled windows and the given window IDs are
/// excluded from the shot.
pub(crate) fn target_display(id: u32, exclude_window_titles: &[String], exclude_window_ids: &[u32]) -> TargetRequest {
    TargetRequest::display(id, exclude_window_titles, exclude_window_ids)
}

/// Empty when build.rs could not compile the helper (no Xcode CLT); the
/// worker is then unavailable and capture falls back to `screencapture`.
const HELPER: &[u8] = include_bytes!(env!("SENPI_DESKTOP_CAPTURE_HELPER"));

/// `SENPI_DESKTOP_CAPTURE_HELPER_PROGRAM` replaces the helper binary (tests,
/// and the release pipeline's signed staging probe).
const ENV_HELPER_PROGRAM: &str = "SENPI_DESKTOP_CAPTURE_HELPER_PROGRAM";

thread_local! {
    /// The owning `MacosBackend` lives on the session thread, so its helper
    /// cannot outlive that thread or contend with another session's pipes.
    /// The temp dir staging the embedded helper lives beside it.
    static HELPER_CLIENT: RefCell<Option<(HelperClient, Option<tempfile::TempDir>)>> =
        const { RefCell::new(None) };
}

fn supports_sck() -> bool {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    version.majorVersion >= 14
}

/// Why the SCK worker cannot serve this capture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SckUnavailable {
    /// macOS < 14: the caller falls back to `screencapture` and logs once.
    Unsupported,
    /// No helper is staged and none is embedded.
    HelperUnavailable,
}

/// How one helper capture failed. Start failures fall back silently; reply
/// errors surface with the worker alive; transport deaths surface after the
/// worker was reset for the next capture.
#[derive(Debug)]
pub(crate) enum SckCaptureError {
    /// The helper could not be started on macOS 14+: the caller falls back
    /// to `screencapture` and logs once.
    Start(DesktopError),
    /// The capture failed; surface this error to the caller.
    Failed(DesktopError),
    /// A started worker exceeded its in-lock budget. The worker was reset;
    /// the caller falls back to `screencapture` for this capture.
    TimedOut(DesktopError),
}

/// How long a warm-up may take: the helper's cold start plus its first
/// shareable-content fetch. It runs before the capture lock is taken.
const WARM_TIMEOUT: Duration = Duration::from_secs(5);

/// The warm-up budget; tests replace it so a fake helper's interpreter start
/// on a loaded host cannot decide a test, and timeout tests stay short.
fn warm_timeout() -> Duration {
    #[cfg(test)]
    if let Some(budget) = TEST_WARM_TIMEOUT.get() {
        return budget;
    }
    WARM_TIMEOUT
}

// Tests default to a 30 s warm-up so a fake helper's interpreter start on a
// loaded host never decides a test; the production 5 s budget is covered by
// the timeout tests, which set their own short budget.
#[cfg(test)]
thread_local! {
    /// Helper starts on this thread, so tests can prove a start was skipped.
    pub(crate) static TEST_STARTS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    pub(crate) static TEST_WARM_TIMEOUT: std::cell::Cell<Option<Duration>> =
        const { std::cell::Cell::new(Some(Duration::from_secs(30))) };
}

/// After a warm-up or an in-lock capture times out, the worker stays off this
/// long; captures use the legacy path meanwhile instead of each paying the
/// timeout again (and, in-lock, blocking other sessions for it). Like the
/// worker itself, the cooldown is per session thread: another session on the
/// same slow Mac pays its own first timeout before its cooldown starts.
const WARM_STALL_COOLDOWN: Duration = Duration::from_secs(30);

/// In-lock capture budget, sized from warm batches through the real helper on
/// an M5 Max under load average ~120 (min / median / max, 15 runs each):
/// 1 target 737 / 1099 / 1763 ms, 3 targets 799 / 1582 / 2861 ms, 8 targets
/// 1410 / 2001 / 4206 ms. A batch costs ~0.7 s fixed (the content fetch) plus
/// ~0.1 s per target at best, so the budget is 2 s + 0.5 s per target (at
/// least 20% above every observed maximum), capped at 6 s; overlay
/// coordination waits 8 s.
const IN_LOCK_BASE: Duration = Duration::from_millis(2000);
const IN_LOCK_PER_TARGET: Duration = Duration::from_millis(500);
pub(crate) const IN_LOCK_MAX: Duration = Duration::from_secs(6);

pub(crate) fn in_lock_budget(targets: usize) -> Duration {
    let per_target = IN_LOCK_PER_TARGET.saturating_mul(u32::try_from(targets).unwrap_or(u32::MAX));
    IN_LOCK_BASE.saturating_add(per_target).min(IN_LOCK_MAX)
}

thread_local! {
    /// Until when a timed-out warm-up or capture keeps the worker off (see `WARM_STALL_COOLDOWN`).
    static WARM_STALLED_UNTIL: std::cell::Cell<Option<std::time::Instant>> =
        const { std::cell::Cell::new(None) };
}

/// The worker handle `MacCapture` holds. Cheap and stateless: the worker
/// itself is the session-thread singleton above.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SckWorker;

impl SckWorker {
    pub(crate) fn availability() -> Result<(), SckUnavailable> {
        if !supports_sck() {
            return Err(SckUnavailable::Unsupported);
        }
        if HELPER.is_empty() && std::env::var_os(ENV_HELPER_PROGRAM).is_none() {
            return Err(SckUnavailable::HelperUnavailable);
        }
        Ok(())
    }

    /// Starts the helper if needed and waits for its warm-up reply. Call it
    /// before taking the capture lock: a cold or stalled helper then costs the
    /// caller time without holding the lock. An error is a start failure.
    pub(crate) fn prepare() -> CoreResult<()> {
        #[cfg(test)]
        if TEST_CAPTURE.with(std::cell::Cell::get).is_some() {
            return Ok(());
        }
        HELPER_CLIENT.with_borrow_mut(|slot| {
            if slot.is_some() {
                return Ok(());
            }
            let now = std::time::Instant::now();
            if WARM_STALLED_UNTIL.get().is_some_and(|until| now < until) {
                return Err(DesktopError::capture_failed(
                    "the capture worker timed out recently; using the screencapture fallback",
                ));
            }
            let (mut client, staging) = start_client()?;
            match client.ping(warm_timeout()) {
                Ok(()) => {
                    WARM_STALLED_UNTIL.set(None);
                    *slot = Some((client, staging));
                    Ok(())
                },
                Err(ClientError::Transport(error) | ClientError::Reply(error)) => {
                    if error.code == ErrorCode::Timeout {
                        WARM_STALLED_UNTIL.set(Some(now + WARM_STALL_COOLDOWN));
                    }
                    Err(error)
                },
            }
        })
    }

    /// One batch capture through the persistent helper, bounded by
    /// `in_lock_budget` for the batch size.
    pub(crate) fn capture(
        requests: &[TargetRequest],
    ) -> Result<Vec<frame::Frame>, SckCaptureError> {
        #[cfg(test)]
        if let Some(fake) = TEST_CAPTURE.with(std::cell::Cell::get) {
            return fake(requests);
        }
        HELPER_CLIENT.with_borrow_mut(|slot| {
            // Never start a helper here: this runs under the capture lock.
            // `prepare` (before the lock) restarts a worker that died.
            let Some((client, _)) = slot.as_mut() else {
                return Err(SckCaptureError::Start(DesktopError::capture_failed(
                    "the capture worker is not running; it restarts before the next capture",
                )));
            };
            match client.capture_within(requests, in_lock_budget(requests.len())) {
                Ok(frames) => Ok(frames),
                Err(ClientError::Transport(error)) => {
                    let first_reply = !client.has_replied;
                    *slot = None;
                    Err(if first_reply {
                        SckCaptureError::Start(error)
                    } else if error.code == ErrorCode::Timeout {
                        WARM_STALLED_UNTIL.set(Some(std::time::Instant::now() + WARM_STALL_COOLDOWN));
                        SckCaptureError::TimedOut(error)
                    } else {
                        SckCaptureError::Failed(error)
                    })
                },
                Err(ClientError::Reply(error)) => Err(SckCaptureError::Failed(error)),
            }
        })
    }
}

/// Picks the helper program: the env seam, then the embedded bytes staged
/// into a fresh private temp dir (returned so the caller can keep it alive
/// beside the client).
fn start_client() -> CoreResult<(HelperClient, Option<tempfile::TempDir>)> {
    #[cfg(test)]
    TEST_STARTS.set(TEST_STARTS.get() + 1);
    #[cfg(test)]
    if let Some(program) = test_support::program() {
        return HelperClient::start(&program).map(|client| (client, None));
    }
    if let Some(program) = std::env::var_os(ENV_HELPER_PROGRAM).map(PathBuf::from) {
        return HelperClient::start(&program).map(|client| (client, None));
    }
    if HELPER.is_empty() {
        return Err(DesktopError::capture_failed(
            "no ScreenCaptureKit capture helper is staged",
        ));
    }
    let dir = tempfile::Builder::new()
        .prefix("senpi-desktop-capture-")
        .tempdir()
        .map_err(|error| {
            DesktopError::internal(format!("cannot stage the capture helper: {error}"))
        })?;
    let program = dir.path().join("senpi-desktop-capture-helper");
    std::fs::write(&program, HELPER)
        .map_err(|error| {
            DesktopError::internal(format!("cannot write the capture helper: {error}"))
        })?;
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| {
                DesktopError::internal(format!(
                    "cannot mark the capture helper executable: {error}"
                ))
            })?;
    }
    let client = HelperClient::start(&program)?;
    Ok((client, Some(dir)))
}

#[cfg(test)]
type CaptureDouble = fn(&[TargetRequest]) -> Result<Vec<frame::Frame>, SckCaptureError>;

#[cfg(test)]
thread_local! {
    static TEST_CAPTURE: std::cell::Cell<Option<CaptureDouble>> =
        const { std::cell::Cell::new(None) };
}

/// Routes `SckWorker::capture` to a test double.
#[cfg(test)]
pub(crate) fn override_capture(fake: Option<CaptureDouble>) {
    TEST_CAPTURE.with(|cell| cell.set(fake));
}
