//! The fake backend's scripted menu tree: listing children along a path and
//! selecting a leaf command through core's shared matching rules.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::menus::{match_index, require_command, require_enabled, validate_path, MenuItem};
use senpi_desktop_core::types::DesktopWindow;

use crate::fake::FakeBackend;
use crate::scenario::FakeMenuNode;
use crate::sink::SinkOp;

fn describe(node: &FakeMenuNode, parent: &[String]) -> MenuItem {
    let mut path = parent.to_vec();
    path.push(node.title.clone());
    MenuItem {
        title: node.title.clone(),
        path,
        enabled: node.enabled,
        checked: node.checked,
        has_submenu: !node.children.is_empty(),
        shortcut: node.shortcut.clone(),
    }
}

/// The children of the tree rooted at `nodes`, with separators dropped, like
/// a native menu listing skips untitled items.
fn children(nodes: &[FakeMenuNode], parent: &[String]) -> Vec<(usize, MenuItem)> {
    nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| !node.title.is_empty())
        .map(|(index, node)| (index, describe(node, parent)))
        .collect()
}

impl FakeBackend {
    /// Resolves the scripted tree of `window`, or `AxUnsupported` when the
    /// scenario carries none for it.
    fn menu_tree(&self, window: &DesktopWindow) -> CoreResult<&Vec<FakeMenuNode>> {
        self.window(&window.id)?;
        self.menus
            .get(&window.id)
            .ok_or_else(senpi_desktop_core::error::DesktopError::ax_unsupported)
    }

    /// Walks `path` submenu by submenu, refusing a disabled submenu before
    /// descending, and returns the items of the menu it lands on.
    fn walk(
        &self,
        window: &DesktopWindow,
        path: &[String],
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<Vec<MenuItem>> {
        let mut nodes = self.menu_tree(window)?;
        let mut actual_path: Vec<String> = Vec::with_capacity(path.len());
        for label in path {
            check_stop()?;
            let listed = children(nodes, &actual_path);
            let items: Vec<MenuItem> = listed.iter().map(|(_, item)| item.clone()).collect();
            let index = match_index(&items, label)?;
            require_enabled(&items[index])?;
            let (node_index, item) = &listed[index];
            let node = &nodes[*node_index];
            if node.children.is_empty() {
                return Err(senpi_desktop_core::error::DesktopError::ax_failed(format!(
                    "menu item '{}' does not expose a submenu",
                    item.title
                )));
            }
            actual_path.push(item.title.clone());
            nodes = &node.children;
        }
        Ok(children(nodes, &actual_path)
            .into_iter()
            .map(|(_, item)| item)
            .collect())
    }

    pub(crate) fn menu_items_impl(&mut self, window: &DesktopWindow, path: &[String]) -> CoreResult<Vec<MenuItem>> {
        self.begin(crate::method::FakeMethod::MenuItems)?;
        validate_path(path, true)?;
        self.walk(window, path, &|| Ok(()))
    }

    pub(crate) fn menu_select_impl(
        &mut self,
        window: &DesktopWindow,
        path: &[String],
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<()> {
        self.begin(crate::method::FakeMethod::MenuSelect)?;
        validate_path(path, false)?;
        let (parents, leaf) = path.split_at(path.len() - 1);
        let items = self.walk(window, parents, check_stop)?;
        let index = match_index(&items, &leaf[0])?;
        require_command(&items[index])?;
        check_stop()?;
        self.record(SinkOp::MenuSelect {
            window: window.id.clone(),
            path: items[index].path.clone(),
        });
        Ok(())
    }
}
