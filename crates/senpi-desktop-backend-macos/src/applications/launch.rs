//! The Launch Services open shared by applications and documents: one
//! `NSWorkspaceOpenConfiguration` that never prompts, adds to Recent Items or
//! starts a second instance, and activates only when asked.

use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use block2::{DynBlock, RcBlock};
use objc2::rc::{autoreleasepool, Retained};
use objc2_app_kit::{NSRunningApplication, NSWorkspace, NSWorkspaceOpenConfiguration};
use objc2_foundation::{NSError, NSString, NSURL};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::Application;

use super::inventory;

/// How long Launch Services gets to confirm an open before `Timeout`.
const LAUNCH_DEADLINE: Duration = Duration::from_secs(30);
const LAUNCH_POLL: Duration = Duration::from_millis(20);

pub(super) fn open_configuration(activate: bool) -> Retained<NSWorkspaceOpenConfiguration> {
    let configuration = NSWorkspaceOpenConfiguration::configuration();
    configuration.setActivates(activate);
    configuration.setCreatesNewApplicationInstance(false);
    configuration.setAddsToRecentItems(false);
    configuration.setPromptsUserIfNeeded(false);
    configuration
}

pub(super) type LaunchCompletion = DynBlock<dyn Fn(*mut NSRunningApplication, *mut NSError)>;

/// Launches the bundle at `path` (validated as a bundle, never run as a
/// command) and returns it as the running application.
pub(super) fn launch(path: &str, activate: bool, check_stop: &dyn Fn() -> CoreResult<()>) -> CoreResult<Application> {
    autoreleasepool(|_| {
        let app = inventory::from_path(Path::new(path))?;
        let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&app.path), true);
        let configuration = open_configuration(activate);
        launch_services("the application", check_stop, |completion| {
            NSWorkspace::sharedWorkspace().openApplicationAtURL_configuration_completionHandler(
                &url,
                &configuration,
                Some(completion),
            );
        })
    })
}

fn completion_result(subject: &str, running: *mut NSRunningApplication, error: *mut NSError) -> CoreResult<Application> {
    // SAFETY: AppKit hands the completion block live, borrowed objects; only
    // owned Rust values leave this function and the pointers are not kept.
    unsafe {
        if let Some(error) = error.as_ref() {
            let domain = error.domain().to_string();
            let message = format!(
                "Launch Services could not open {subject} ({domain} {}): {}",
                error.code(),
                error.localizedDescription()
            );
            let denied = (domain == "NSCocoaErrorDomain" && matches!(error.code(), 257 | 513))
                || (domain == "NSOSStatusErrorDomain" && matches!(error.code(), -54 | -5000));
            return Err(if denied { DesktopError::permission_denied(message) } else { DesktopError::input_failed(message) });
        }
        match running.as_ref() {
            Some(running) => inventory::running_application(running).ok_or_else(|| {
                DesktopError::invalid_target("Launch Services returned an application without a bundle path")
            }),
            None => Err(DesktopError::internal("Launch Services returned neither an application nor an error")),
        }
    }
}

/// Runs the Launch Services request `start` makes with the completion block
/// it is given, and waits for the application that opened `what`.
///
/// # Errors
/// The request's own refusal (`PermissionDenied` for Gatekeeper and policy
/// denials, else `InputFailed`), `Timeout` after 30 s ("it may still open"),
/// or `check_stop`'s error.
pub(super) fn launch_services(
    what: &str,
    check_stop: &dyn Fn() -> CoreResult<()>,
    start: impl FnOnce(&LaunchCompletion),
) -> CoreResult<Application> {
    let (sender, receiver) = mpsc::sync_channel(1);
    let subject = what.to_owned();
    let completion: RcBlock<dyn Fn(*mut NSRunningApplication, *mut NSError)> =
        RcBlock::new(move |running: *mut NSRunningApplication, error: *mut NSError| {
            let _ = sender.try_send(completion_result(&subject, running, error));
        });
    start(&completion);
    let deadline = Instant::now() + LAUNCH_DEADLINE;
    loop {
        check_stop()?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(DesktopError::timeout(format!(
                "Launch Services did not confirm opening {what} within 30 seconds; it may still open"
            )));
        }
        match receiver.recv_timeout(remaining.min(LAUNCH_POLL)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(DesktopError::internal("Launch Services completion channel closed"));
            }
        }
    }
}
