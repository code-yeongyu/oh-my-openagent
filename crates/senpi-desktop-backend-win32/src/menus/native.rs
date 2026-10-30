//! Bounded attached-menu traversal and pre-dispatch revalidation.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::menus::{match_index, require_command, require_enabled, MenuItem};

use super::{failed, native_message, MAX_ITEMS, NOTIFY_BY_POSITION};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Entry {
    pub menu: usize,
    pub position: u32,
    pub id: u32,
    pub submenu: usize,
}

pub(crate) struct Level {
    pub items: Vec<MenuItem>,
    pub entries: Vec<Entry>,
    pub count: i32,
}

pub(crate) trait NativeMenu {
    fn level(&self, menu: usize, path: &[String]) -> CoreResult<Level>;
    fn attached(&self, root: usize) -> CoreResult<()>;
    fn count(&self, menu: usize) -> CoreResult<i32>;
    fn style(&self, menu: usize) -> CoreResult<u32>;
    fn dispatch(&self, entry: Entry, message: u32, wparam: usize) -> CoreResult<()>;
}

struct Node {
    item: MenuItem,
    entry: Entry,
    chain: Vec<(Entry, i32)>,
}

fn resolve(
    source: &impl NativeMenu,
    root: usize,
    path: &[String],
    stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<Node> {
    let mut menu = root;
    let mut canonical = Vec::new();
    let mut chain = Vec::with_capacity(path.len());
    for (depth, label) in path.iter().enumerate() {
        stop()?;
        let mut level = source.level(menu, &canonical)?;
        let index = match_index(&level.items, label)?;
        let item = level.items.swap_remove(index);
        require_enabled(&item)?;
        let entry = level.entries[index];
        chain.push((entry, level.count));
        if depth + 1 == path.len() {
            return Ok(Node { item, entry, chain });
        }
        if entry.submenu == 0 {
            return Err(failed(format!("menu item '{}' has no submenu", item.title)));
        }
        canonical = item.path;
        menu = entry.submenu;
    }
    Err(failed("a menu command path is required"))
}

pub(crate) fn items(source: &impl NativeMenu, root: usize, path: &[String]) -> CoreResult<Vec<MenuItem>> {
    let level = if path.is_empty() {
        source.level(root, path)?
    } else {
        let node = resolve(source, root, path, &|| Ok(()))?;
        require_enabled(&node.item)?;
        if node.entry.submenu == 0 {
            return Err(failed("the requested menu path is a leaf command, not a submenu"));
        }
        source.level(node.entry.submenu, &node.item.path)?
    };
    source.attached(root)?;
    Ok(level.items)
}

pub(crate) fn select(
    source: &impl NativeMenu,
    root: usize,
    path: &[String],
    stop: &dyn Fn() -> CoreResult<()>,
) -> CoreResult<()> {
    let original = resolve(source, root, path, stop)?;
    require_command(&original.item)?;
    let current = resolve(source, root, path, stop)?;
    require_command(&current.item)?;
    if original.chain != current.chain || original.item.path != current.item.path {
        return Err(failed("native menu changed; no command was dispatched"));
    }
    // Windows documents MNS_NOTIFYBYPOS as a menu-header style, so the menu
    // bar's style decides; yet some implementations also honour it on a
    // submenu alone, and for that one case the notification form is
    // disputed, so it is refused rather than guessed.
    let style = source.style(root)?;
    let containing = source.style(current.entry.menu)?;
    if style & NOTIFY_BY_POSITION == 0 && containing & NOTIFY_BY_POSITION != 0 {
        return Err(failed(
            "the menu bar and the containing menu disagree on position notification; no command was dispatched",
        ));
    }
    let (message, wparam) = native_message(current.entry.id, current.entry.position, style)?;
    source.attached(root)?;
    for (entry, count) in &current.chain {
        if source.count(entry.menu)? != *count {
            return Err(failed("native menu item count changed; no command was dispatched"));
        }
    }
    stop()?;
    source.dispatch(current.entry, message, wparam)
}

pub(crate) fn bounded_count(count: i32) -> CoreResult<usize> {
    usize::try_from(count)
        .ok()
        .filter(|count| *count <= MAX_ITEMS)
        .ok_or_else(|| failed("native menu is unavailable or exceeds the bounded item limit"))
}
