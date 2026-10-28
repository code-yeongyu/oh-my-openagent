//! Platform-neutral `apps.list` / `apps.open` logic (ported from oh-my-pi
//! `desktop/applications.rs` at 0838d2ab44, MIT): the inventory filter, the
//! identity-before-name resolution that never launches an ambiguous app, and
//! the application-vs-document routing. Backends supply the inventory and
//! the native open.

use std::path::Path;

use crate::error::{CoreResult, DesktopError};
use crate::protocol_params::{AppsListParams, AppsOpenParams};
use crate::types::Application;

/// `apps.list`'s view of `apps`: the running ones when asked, then a
/// case-insensitive substring match on name, id or path, sorted by name, id,
/// path.
#[must_use]
pub fn filter(mut apps: Vec<Application>, params: &AppsListParams) -> Vec<Application> {
    let query = params.query.as_deref().unwrap_or_default().to_lowercase();
    let running_only = params.running_only.unwrap_or(false);
    apps.retain(|app| {
        (!running_only || app.running)
            && (query.is_empty()
                || app.name.to_lowercase().contains(&query)
                || app.id.to_lowercase().contains(&query)
                || app.path.to_lowercase().contains(&query))
    });
    apps.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)).then(a.path.cmp(&b.path)));
    apps
}

/// Resolves `input` among `apps`: an exact id or path first, then a display
/// name (case-insensitive). A name that one regular app and only helpers
/// share names the regular app (macOS calls both Contacts and its
/// `PeopleViewService` "Contacts"); two regular apps are ambiguous.
///
/// # Errors
/// `InvalidTarget` naming two candidate paths when the input is ambiguous.
pub fn resolve_by<'a>(
    apps: &'a [Application],
    input: &str,
    is_helper: impl Fn(&Application) -> bool,
) -> CoreResult<Option<&'a Application>> {
    let mut exact = apps.iter().filter(|app| app.id == input || app.path == input);
    if let Some(first) = exact.next() {
        return unique(first, exact.next(), input).map(Some);
    }
    let folded = input.to_lowercase();
    let mut names = apps.iter().filter(|app| app.name.to_lowercase() == folded);
    let Some(first) = names.next() else {
        return Ok(None);
    };
    let Some(second) = names.next() else {
        return Ok(Some(first));
    };
    let mut regular = [first, second].into_iter().chain(names).filter(|app| !is_helper(app));
    match (regular.next(), regular.next()) {
        (Some(only), None) => Ok(Some(only)),
        (Some(one), Some(other)) => unique(one, Some(other), input).map(Some),
        (None, _) => unique(first, Some(second), input).map(Some),
    }
}

fn unique<'a>(first: &'a Application, second: Option<&Application>, input: &str) -> CoreResult<&'a Application> {
    if let Some(second) = second {
        return Err(DesktopError::invalid_target(format!(
            "application {input:?} is ambiguous; use an exact native path (matches include {:?} and {:?})",
            first.path, second.path,
        )));
    }
    Ok(first)
}

/// `app`, read from an explicit path, with the running state of the listed
/// application at the same path: a bundle read alone says it is not running,
/// and launching a running application again would reopen it.
#[must_use]
pub fn with_listed_state(apps: &[Application], app: Application) -> Application {
    apps.iter().find(|listed| listed.path == app.path).cloned().unwrap_or(app)
}

/// The installed application `input` names among `apps`: an id or native
/// path, then an explicit path read through `from_path`, then a display name.
///
/// # Errors
/// `InvalidTarget` when nothing matches or the name is ambiguous.
pub fn application(
    apps: &[Application],
    input: &str,
    is_helper: impl Fn(&Application) -> bool,
    from_path: impl FnOnce(&Path) -> CoreResult<Application>,
) -> CoreResult<Application> {
    if apps.iter().any(|app| app.id == input || app.path == input) {
        return resolve_by(apps, input, is_helper)?
            .cloned()
            .ok_or_else(|| DesktopError::invalid_target("application disappeared"));
    }
    let path = Path::new(input);
    if path.is_absolute() || input.contains(std::path::MAIN_SEPARATOR) || path.exists() {
        return Ok(with_listed_state(apps, from_path(path)?));
    }
    resolve_by(apps, input, is_helper)?.cloned().ok_or_else(|| {
        DesktopError::invalid_target(format!(
            "application {input:?} was not found; use apps.list() or an existing native application path"
        ))
    })
}

/// The scheme of a URL such as `https://…` or `x-apple.systempreferences:…`;
/// never a Windows drive letter (`C:`), which is one character.
#[must_use]
pub fn url_scheme(input: &str) -> Option<&str> {
    let (scheme, _) = input.split_once(':')?;
    (scheme.len() > 1
        && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')))
    .then_some(scheme)
}

/// Whether `path` names a macOS application bundle (`.app`).
#[must_use]
pub fn is_app_bundle(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension.as_encoded_bytes().eq_ignore_ascii_case(b"app"))
}

/// Whether `apps.open` takes `input` as a document rather than an
/// application: a URL, or on macOS an existing file or folder that is not an
/// `.app` bundle.
#[must_use]
pub fn opens_as_document(input: &str) -> bool {
    let path = Path::new(input);
    if path.exists() {
        return cfg!(target_os = "macos") && !is_app_bundle(path);
    }
    url_scheme(input).is_some()
}

/// What `apps.open` opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    Application,
    Document,
}

/// `app` and `reveal` ask for a document. Otherwise an exact inventory id or
/// native path is an application, so neither a same-named file nor a URL
/// shadows it; then [`opens_as_document`] decides.
#[must_use]
pub fn route(apps: &[Application], params: &AppsOpenParams) -> Route {
    if params.reveal.unwrap_or(false) || params.app.is_some() {
        return Route::Document;
    }
    if apps.iter().any(|app| app.id == params.id || app.path == params.id) {
        return Route::Application;
    }
    if opens_as_document(&params.id) {
        Route::Document
    } else {
        Route::Application
    }
}

/// Refuses an `apps.open` request that can never open anything, before any
/// inventory read: an empty or NUL-bearing identity, or `reveal` with `app`.
///
/// # Errors
/// `InvalidTarget`.
pub fn validate(params: &AppsOpenParams) -> CoreResult<()> {
    if params.id.is_empty() || params.id.contains('\0') {
        return Err(DesktopError::invalid_target(
            "application identity must be nonempty and contain no NUL",
        ));
    }
    if params.reveal.unwrap_or(false) && params.app.is_some() {
        return Err(DesktopError::invalid_target(
            "apps.open takes reveal or app, not both: reveal shows the item in Finder",
        ));
    }
    Ok(())
}

impl AppsOpenParams {
    /// Whether the request brings something in front of the user: activating
    /// the application, or revealing an item in Finder, which comes forward.
    #[must_use]
    pub fn takes_foreground(&self) -> bool {
        self.activate.unwrap_or(false) || self.reveal.unwrap_or(false)
    }
}

#[cfg(test)]
mod tests;
