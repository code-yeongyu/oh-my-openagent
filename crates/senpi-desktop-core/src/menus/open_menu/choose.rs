//! Walking a path through an open menu to the item to press, and listing a
//! menu's items as errors name them.

use super::{Entry, Menus, MAX_LISTED_DEPTH, MAX_LISTED_ITEMS};
use crate::menus::{match_index, require_enabled, MenuItem};

/// Why a path chose nothing, and the items of the level where it stopped.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Refusal {
    pub(super) message: String,
    pub(super) items: String,
}

/// The command item a path ends at, and its path as errors name it.
pub(super) struct Leaf<N> {
    pub(super) node: N,
    pub(super) path: String,
}

/// Walks `path` from `menu` to the item to press. Labels match as in
/// `win.menu.select`: case-insensitively, a trailing ellipsis tolerated, and
/// a label matching two items refuses. Each item on the way must be enabled,
/// and the leaf must be a command rather than a submenu.
pub(super) fn choose<M: Menus>(
    menus: &mut M,
    menu: &M::Node,
    path: &[String],
) -> Result<Leaf<M::Node>, Refusal> {
    let mut menu = menu.clone();
    let mut walked: Vec<String> = Vec::with_capacity(path.len());
    for (depth, label) in path.iter().enumerate() {
        let entries = menus.items(&menu).map_err(|error| Refusal {
            message: format!("its items could not be read ({})", error.message),
            items: String::new(),
        })?;
        let items: Vec<MenuItem> = entries
            .iter()
            .map(|entry| MenuItem {
                title: entry.title.clone(),
                path: walked.iter().chain([&entry.title]).cloned().collect(),
                enabled: entry.enabled,
                checked: false,
                has_submenu: entry.submenu.is_some(),
                shortcut: None,
            })
            .collect();
        let refuse = |menus: &mut M, message: String| {
            let mut budget = MAX_LISTED_ITEMS.saturating_sub(entries.len());
            Refusal {
                message,
                items: render(menus, &entries, 0, &mut budget),
            }
        };
        let index = match match_index(&items, label) {
            Ok(index) => index,
            Err(error) => return Err(refuse(menus, error.message)),
        };
        let (entry, item) = (&entries[index], &items[index]);
        if let Err(error) = require_enabled(item) {
            return Err(refuse(menus, error.message));
        }
        if depth + 1 < path.len() {
            let Some(submenu) = &entry.submenu else {
                return Err(refuse(
                    menus,
                    format!("menu item '{}' has no submenu", entry.title),
                ));
            };
            menu = submenu.clone();
            walked.push(entry.title.clone());
            continue;
        }
        if let Some(submenu) = &entry.submenu {
            return Err(Refusal {
                message: format!(
                    "menu item '{}' opens a submenu, and the path must end at one of its items",
                    item.path.join(" > ")
                ),
                items: listing(menus, submenu),
            });
        }
        return Ok(Leaf {
            node: entry.node.clone(),
            path: item.path.join(" > "),
        });
    }
    Err(Refusal {
        message: "the menu path is empty".to_string(),
        items: String::new(),
    })
}

pub(super) fn quote_path(path: &[String]) -> String {
    path.iter()
        .map(|label| format!("'{label}'"))
        .collect::<Vec<_>>()
        .join(" > ")
}

/// The items of `menu` as errors list them: titles in menu order, disabled
/// ones marked, and an enabled submenu followed by its own items while
/// [`MAX_LISTED_ITEMS`] allows.
pub fn listing<M: Menus>(menus: &mut M, menu: &M::Node) -> String {
    match menus.items(menu) {
        Ok(entries) => {
            let mut budget = MAX_LISTED_ITEMS.saturating_sub(entries.len());
            render(menus, &entries, 0, &mut budget)
        }
        Err(_) => String::new(),
    }
}

/// Renders `entries`, already charged to `budget`, expanding the submenus
/// above [`MAX_LISTED_DEPTH`] that fit in what remains.
fn render<M: Menus>(
    menus: &mut M,
    entries: &[Entry<M::Node>],
    depth: usize,
    budget: &mut usize,
) -> String {
    let mut parts = Vec::with_capacity(entries.len());
    for entry in entries {
        let mut part = format!("\"{}\"", entry.title);
        if !entry.enabled {
            part.push_str(" (disabled)");
        }
        if let Some(submenu) = &entry.submenu {
            part.push_str(" \u{25b8}");
            if entry.enabled && depth < MAX_LISTED_DEPTH {
                if let Ok(children) = menus.items(submenu) {
                    if !children.is_empty() && children.len() <= *budget {
                        *budget -= children.len();
                        part.push_str(" [");
                        part.push_str(&render(menus, &children, depth + 1, budget));
                        part.push(']');
                    }
                }
            }
        }
        parts.push(part);
    }
    parts.join(", ")
}
