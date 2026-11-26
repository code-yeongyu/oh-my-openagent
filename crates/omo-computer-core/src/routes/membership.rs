//! The `chromium_electron` class matcher as DATA (d-windows.md:157, d-linux.md:78,
//! d-macos.md:159), kept apart from the exact-key table. Windows matches anchored at the start:
//! `Chrome_WidgetWin_` with a non-empty suffix, any class starting `CefBrowser`, and the exact
//! `Chrome_RenderWidgetHostHWND`; X11 matches the listed `WM_CLASS` strings whole; macOS matches
//! a listed bundle id or that id followed by `.` and more. Never a substring of a title or name.

use serde::Deserialize;
use serde_json::Value;

use super::{invalid, RouteOs, RouteTableInvalid};

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Windows {
    prefix_with_suffix: Vec<String>,
    starts_with: Vec<String>,
    exact: Vec<String>,
}

/// The loaded matcher.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Membership {
    windows: Windows,
    x11: Vec<String>,
    macos: Vec<String>,
}

fn strings(value: Option<&Value>, field: &str, at: &str) -> Result<Vec<String>, RouteTableInvalid> {
    let Some(list) = value.and_then(|v| v.get(field)) else {
        return Ok(Vec::new());
    };
    serde_json::from_value(list.clone()).map_err(|_| invalid(&format!("{at}/{field}")))
}

impl Membership {
    /// # Errors
    /// [`RouteTableInvalid`] at the malformed membership field.
    pub(super) fn load(doc: Option<&Value>) -> Result<Self, RouteTableInvalid> {
        let windows = match doc.and_then(|d| d.get("windows")) {
            None => Windows::default(),
            Some(w) => Windows {
                prefix_with_suffix: strings(Some(w), "prefixWithSuffix", "/membership/windows")?,
                starts_with: strings(Some(w), "startsWith", "/membership/windows")?,
                exact: strings(Some(w), "exact", "/membership/windows")?,
            },
        };
        Ok(Self {
            windows,
            x11: strings(doc.and_then(|d| d.get("x11")), "exactWmClass", "/membership/x11")?,
            macos: strings(doc.and_then(|d| d.get("macos")), "bundleIds", "/membership/macos")?,
        })
    }

    /// Whether `key` (window class / `WM_CLASS` / bundle id) is a `chromium_electron` member.
    #[must_use]
    pub fn is_member(&self, os: RouteOs, key: &str) -> bool {
        match os {
            RouteOs::Windows => {
                self.windows.exact.iter().any(|e| e == key)
                    || self.windows.starts_with.iter().any(|p| key.starts_with(p.as_str()))
                    || self
                        .windows
                        .prefix_with_suffix
                        .iter()
                        .any(|p| key.len() > p.len() && key.starts_with(p.as_str()))
            }
            RouteOs::X11 => self.x11.iter().any(|class| class == key),
            RouteOs::Macos => self.macos.iter().any(|id| {
                key == id || key.strip_prefix(id.as_str()).is_some_and(|rest| rest.len() > 1 && rest.starts_with('.'))
            }),
        }
    }
}

/// The shipped matcher's verdict.
#[must_use]
pub fn is_chromium_electron(os: RouteOs, key: &str) -> bool {
    super::RouteTable::seed().is_ok_and(|table| table.membership().is_member(os, key))
}
