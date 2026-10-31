//! The scripted accessibility and menu node shapes a scenario embeds.

use serde::Deserialize;

/// One scripted accessibility element and its subtree.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeAxNode {
    pub role: String,
    /// Platform role; defaults to `role`.
    #[serde(default)]
    pub native_role: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub focused: bool,
    /// Global logical bounds.
    #[serde(default)]
    pub bounds: Option<FakeBounds>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub children: Vec<FakeAxNode>,
}

/// One scripted menu item and its submenu.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeMenuNode {
    pub title: String,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    #[serde(default)]
    pub checked: bool,
    #[serde(default)]
    pub shortcut: Option<String>,
    #[serde(default)]
    pub children: Vec<FakeMenuNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FakeBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub(crate) const fn enabled_by_default() -> bool {
    true
}
