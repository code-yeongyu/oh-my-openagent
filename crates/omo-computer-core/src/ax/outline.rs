//! The outline grammar: one line per element, `- role "label" [ref=s<g>:e<n>]`, then the
//! window identity on the root, the known states, the value, the actions when asked, the cut
//! marker and the `(?)` mark of an unread label or value.

use super::node::{NodeRead, RootRead, Seen};

/// Characters of a label or value a line shows before `…`.
pub const LABEL_CHARS: usize = 80;

/// What a line carries beyond the always-rendered fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LineStyle {
    /// `actions=[...]` (`ObserveOptions.actions`).
    pub actions: bool,
    /// The value; a skeleton leaves it off its cut containers.
    pub value: bool,
}

fn clipped(text: &str) -> String {
    let mut out: String = text.chars().take(LABEL_CHARS).collect();
    if text.chars().count() > LABEL_CHARS {
        out.push('…');
    }
    out.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
}

const MUTABLE_VALUE_ROLES: &[&str] = &["textfield", "textarea", "combobox", "searchfield", "slider"];

/// The rendered label: the title, else the description. For a mutable-value role a title equal
/// to the value is dropped, so the value is not printed twice.
#[must_use]
pub fn label(node: &NodeRead) -> Option<&str> {
    let title = node.title.as_deref().filter(|title| {
        !(MUTABLE_VALUE_ROLES.contains(&node.role.as_str()) && node.value.as_deref() == Some(*title))
    });
    title
        .or(node.description.as_deref())
        .filter(|text| !text.trim().is_empty())
}

/// ` app=<app> win=<id>/<pid>/<processStart>`: what the root line's refs bind to.
#[must_use]
pub fn root_suffix(root: &RootRead) -> String {
    format!(
        " app={} win={}/{}/{}",
        root.app, root.window.id, root.window.pid, root.window.process_start
    )
}

/// One element's line without indentation. `more` is the count of children a cut left out.
#[must_use]
pub fn line(node: &NodeRead, token: &str, extra: &str, style: LineStyle, more: Option<u32>) -> String {
    let mut out = format!("- {}", node.role);
    if let Some(label) = label(node) {
        out.push_str(&format!(" \"{}\"", clipped(label)));
    }
    out.push_str(&format!(" [ref={token}]{extra}"));
    let states = [
        (node.enabled == Some(false), "disabled"),
        (node.focused == Some(true), "focused"),
        (node.secure, "secure"),
        (node.selected == Some(true), "selected"),
        (node.expanded == Some(true), "expanded"),
        (node.checked == Some(true), "checked"),
    ];
    for (_, state) in states.iter().filter(|(on, _)| *on) {
        out.push_str(&format!(" ({state})"));
    }
    if style.value && !node.secure {
        if let Some(value) = node.value.as_deref().filter(|value| !value.is_empty()) {
            out.push_str(&format!(": \"{}\"", clipped(value)));
        }
    }
    if style.actions && !node.actions.is_empty() {
        out.push_str(&format!(" actions=[{}]", node.actions.join(",")));
    }
    if let Some(more) = more {
        out.push_str(&format!(" [... {more} more]"));
    }
    let unread = node.evidence.title == Seen::Unknown
        || node.evidence.description == Seen::Unknown
        || (!node.secure && node.evidence.value == Seen::Unknown);
    if unread {
        out.push_str(" (?)");
    }
    out
}
