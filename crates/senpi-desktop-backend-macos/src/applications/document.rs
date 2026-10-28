//! Opening a file, folder or URL in its default application (or `app`), and
//! revealing an item selected in Finder, which `NSWorkspace` always brings to
//! the front (so the session admits `reveal` only under the grant).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use objc2::rc::{autoreleasepool, Retained};
use objc2_app_kit::{NSRunningApplication, NSWorkspace};
use objc2_foundation::{ns_string, NSArray, NSString, NSURL};
use senpi_desktop_core::apps::url_scheme;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::{Application, DesktopWindow, OpenedApplication};

use super::inventory::running_application;
use super::launch::{launch_services, open_configuration};
use super::open::{first_window, poll_window, FIRST_WINDOW_WAIT};
use super::windows::key_capable_windows;

/// How long a reveal waits for Finder to be running: one that was quit starts
/// only after `activateFileViewerSelectingURLs` returns.
const FINDER_LAUNCH_WAIT: Duration = Duration::from_secs(30);

pub(super) fn open(
    target: &str,
    app: Option<Application>,
    reveal: bool,
    activate: bool,
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<OpenedApplication> {
    let opened = autoreleasepool(|_| {
        let url = document_url(target, reveal)?;
        let workspace = NSWorkspace::sharedWorkspace();
        let urls = NSArray::from_retained_slice(std::slice::from_ref(&url));
        if reveal {
            workspace.activateFileViewerSelectingURLs(&urls);
            return wait_for(FINDER_LAUNCH_WAIT, || autoreleasepool(|_| finder()), || poll_window(check_stop))?
                .ok_or_else(|| DesktopError::internal("Finder did not start after revealing the item"));
        }
        let application = match &app {
            Some(app) => NSURL::fileURLWithPath_isDirectory(&NSString::from_str(&app.path), true),
            None => workspace
                .URLForApplicationToOpenURL(&url)
                .ok_or_else(|| DesktopError::invalid_target(format!("no application opens {target:?}")))?,
        };
        let configuration = open_configuration(activate);
        launch_services(target, check_stop, |completion| {
            workspace.openURLs_withApplicationAtURL_configuration_completionHandler(
                &urls,
                &application,
                &configuration,
                Some(completion),
            );
        })
    })?;
    let name = shown_name(document_path(target, reveal).as_deref(), reveal);
    let window = match opened.pid {
        Some(pid) => first_window(
            false,
            FIRST_WINDOW_WAIT,
            || key_capable_windows(pid).map(|windows| showing(windows, name.as_deref())),
            || false,
            || false,
            || poll_window(check_stop),
        )?,
        None => None,
    };
    Ok(OpenedApplication::new(opened, window))
}

/// The title of the window that shows `path`: its name, or for `reveal` its
/// folder's. `None` for a URL.
pub(super) fn shown_name(path: Option<&Path>, reveal: bool) -> Option<String> {
    let shown = if reveal { path?.parent() } else { path };
    shown.and_then(Path::file_name).map(|name| name.to_string_lossy().into_owned())
}

/// The `windows` whose title names the opened item; all of them for a URL or
/// when no title can be read (without Screen Recording other apps' titles are
/// empty), since nothing then tells the windows apart.
pub(super) fn showing(windows: Vec<DesktopWindow>, name: Option<&str>) -> Vec<DesktopWindow> {
    match name {
        Some(name) if windows.iter().any(|window| !window.title.is_empty()) => {
            windows.into_iter().filter(|window| title_names(&window.title, name)).collect()
        }
        _ => windows,
    }
}

/// Whether `title` names `name` as a whole part (`notes.txt`, `notes.txt —
/// Edited`, `Preview: notes.txt`), never inside a longer name (`data.txt`
/// does not name `a.txt`, nor does `a.txt.bak`).
pub(super) fn title_names(title: &str, name: &str) -> bool {
    let edge = |c: Option<char>| c.is_none_or(|c| c.is_whitespace() || "—–()[]{}\"'“”‘’«»:,|".contains(c));
    title.match_indices(name).any(|(at, _)| {
        edge(title[..at].chars().next_back()) && edge(title[at + name.len()..].chars().next())
    })
}

/// The absolute path of an existing `target`, naming the entry itself: a
/// symlink stays the link so Finder selects what the caller named. To reveal,
/// a link whose target is gone counts too; Finder still shows it.
pub(super) fn document_path(target: &str, reveal: bool) -> Option<PathBuf> {
    let path = Path::new(target);
    let exists = if reveal { path.symlink_metadata().is_ok() } else { path.exists() };
    exists.then(|| std::path::absolute(path).ok()).flatten()
}

pub(super) fn document_url(target: &str, reveal: bool) -> CoreResult<Retained<NSURL>> {
    if let Some(path) = document_path(target, reveal) {
        let path = path.to_str().ok_or_else(|| DesktopError::invalid_target(format!("{target:?} is not valid UTF-8")))?;
        return Ok(NSURL::fileURLWithPath(&NSString::from_str(path)));
    }
    if !reveal && url_scheme(target).is_some() {
        return NSURL::URLWithString(&NSString::from_str(target))
            .ok_or_else(|| DesktopError::invalid_target(format!("{target:?} is not a valid URL")));
    }
    Err(DesktopError::invalid_target(if reveal {
        format!("cannot find {target:?}; reveal shows an existing file or folder")
    } else {
        format!("cannot find {target:?}; apps.open opens an application, an existing file or folder, or a URL")
    }))
}

pub(super) fn wait_for<T>(
    timeout: Duration,
    mut find: impl FnMut() -> Option<T>,
    mut wait: impl FnMut() -> CoreResult<()>,
) -> CoreResult<Option<T>> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(found) = find() {
            return Ok(Some(found));
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        wait()?;
    }
}

fn finder() -> Option<Application> {
    NSRunningApplication::runningApplicationsWithBundleIdentifier(ns_string!("com.apple.finder"))
        .firstObject()
        .and_then(|running| running_application(&running))
}
