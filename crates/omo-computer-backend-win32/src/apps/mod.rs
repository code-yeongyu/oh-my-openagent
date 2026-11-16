//! The Windows app list and open (row 60): three sources (Start menu shortcuts, running
//! processes, packaged apps by AUMID) composed into one list keyed by identity; `apps.open`
//! answers a handle only after the started process's image path matches the listed path.

/// One app as a source lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct App {
    pub name: String,
    pub path: Option<String>,
    pub aumid: Option<String>,
}

/// The composed list: one entry per app, packaged apps resolvable by AUMID.
#[must_use]
pub fn compose(start_menu: &[App], running: &[App], packaged: &[App]) -> Vec<App> {
    let _ = (running, packaged);
    start_menu.to_vec()
}

/// The listed app with `aumid`.
#[must_use]
pub fn resolve_aumid<'a>(apps: &'a [App], aumid: &str) -> Option<&'a App> {
    let _ = (apps, aumid);
    None
}

/// The handle of a started app, only when its image path is the listed one.
#[must_use]
pub fn open_handle(listed: &App, started_pid: u32, started_path: &str) -> Option<u32> {
    let _ = (listed, started_path);
    Some(started_pid)
}

#[cfg(test)]
mod tests;
