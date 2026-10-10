//! Menu-path matching shared by every platform's menu backend: which item a
//! requested label names, and whether it may be invoked as a command.

use crate::error::{CoreResult, DesktopError};

/// Longest menu path any backend accepts.
const MAX_PATH_LABELS: usize = 32;

/// One immediate child of a native application menu. `path` holds the native
/// labels, ellipses included; selection accepts normalized labels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub title: String,
    pub path: Vec<String>,
    pub enabled: bool,
    pub checked: bool,
    pub has_submenu: bool,
    pub shortcut: Option<String>,
}

/// Refuses a path before any native access: 1..=32 labels (0 allowed for
/// listing the menu bar), none empty or containing NUL.
pub fn validate_path(path: &[String], allow_empty: bool) -> CoreResult<()> {
    if (!allow_empty && path.is_empty()) || path.len() > MAX_PATH_LABELS {
        return Err(DesktopError::invalid_target(format!(
            "menu path must contain 1..={MAX_PATH_LABELS} labels"
        )));
    }
    if path.iter().any(|label| label.trim().is_empty() || label.contains('\0')) {
        return Err(DesktopError::invalid_target("menu path contains an empty or NUL label"));
    }
    Ok(())
}

fn without_ellipsis(label: &str) -> &str {
    let label = label.trim();
    label
        .strip_suffix("...")
        .or_else(|| label.strip_suffix('…'))
        .unwrap_or(label)
        .trim_end()
}

/// The index of the item `label` names. A case-insensitive exact title wins
/// over a match with a trailing ellipsis ignored; each tier must match exactly
/// one item, and neither menu order nor enabled state breaks a tie.
pub fn match_index(items: &[MenuItem], label: &str) -> CoreResult<usize> {
    let exact = label.trim().to_lowercase();
    match unique(items, |title| title.trim().to_lowercase() == exact) {
        Unique::One(index) => return Ok(index),
        Unique::Many => return Err(DesktopError::ax_failed(format!("menu label '{label}' is ambiguous"))),
        Unique::None => {}
    }
    let loose = without_ellipsis(label).to_lowercase();
    match unique(items, |title| {
        !without_ellipsis(title).is_empty() && without_ellipsis(title).to_lowercase() == loose
    }) {
        Unique::One(index) => Ok(index),
        Unique::Many => Err(DesktopError::ax_failed(format!(
            "menu label '{label}' is ambiguous after ellipsis normalization"
        ))),
        Unique::None => Err(DesktopError::ax_failed(format!("menu item '{label}' was not found"))),
    }
}

enum Unique {
    None,
    One(usize),
    Many,
}

fn unique(items: &[MenuItem], matches: impl Fn(&str) -> bool) -> Unique {
    let mut found = items.iter().enumerate().filter(|(_, item)| matches(&item.title));
    match (found.next(), found.next()) {
        (None, _) => Unique::None,
        (Some((index, _)), None) => Unique::One(index),
        (Some(_), Some(_)) => Unique::Many,
    }
}

/// Refuses a disabled item. Backends call it on every submenu they open while
/// walking a path, and [`require_command`] calls it on the leaf.
pub fn require_enabled(item: &MenuItem) -> CoreResult<()> {
    if item.enabled {
        Ok(())
    } else {
        Err(DesktopError::ax_failed(format!(
            "menu item '{}' is disabled; no command was dispatched",
            item.path.join(" > ")
        )))
    }
}

/// Refuses an item that may not be invoked as a command: disabled, a submenu,
/// or an untitled separator. Backends re-check this immediately before the
/// native press, because the app can change it after listing.
pub fn require_command(item: &MenuItem) -> CoreResult<()> {
    require_enabled(item)?;
    if item.has_submenu || item.title.trim().is_empty() {
        return Err(DesktopError::ax_failed(
            "select a named leaf menu command, not a submenu or separator",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
