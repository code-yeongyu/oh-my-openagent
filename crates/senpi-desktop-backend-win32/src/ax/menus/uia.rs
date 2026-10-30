//! UIA menu-path resolution and exact-element revalidation.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::menus::{match_index, require_command, require_enabled, MenuItem};
use uiautomation::{UIAutomation, UIElement, UITreeWalker};

use super::super::uia_error;
use super::{super::Win32Ax, target::Target};
use crate::menus::{failed, MAX_UIA_NODES};

pub(super) struct UiaMenus<'a> {
    pub ax: &'a mut Win32Ax,
    pub target: &'a Target,
    pub automation: UIAutomation,
    pub walker: UITreeWalker,
    pub remaining: usize,
    pub stop: &'a dyn Fn() -> CoreResult<()>,
}

pub(super) struct Level {
    pub items: Vec<MenuItem>,
    pub elements: Vec<UIElement>,
}

struct Node {
    element: UIElement,
    item: Option<MenuItem>,
    path: Vec<String>,
}

pub(super) fn unexposed() -> senpi_desktop_core::error::DesktopError {
    failed("the exact window's UIA provider does not expose this menu hierarchy; closed/lazy or detached popup menus cannot be selected safely")
}

impl<'a> UiaMenus<'a> {
    pub fn new(
        ax: &'a mut Win32Ax,
        target: &'a Target,
        stop: &'a dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<Self> {
        let automation = ax.automation.client()?;
        let walker = automation.get_control_view_walker().map_err(uia_error)?;
        Ok(Self {
            ax,
            target,
            automation,
            walker,
            remaining: MAX_UIA_NODES,
            stop,
        })
    }

    pub fn owns(&mut self, element: &UIElement) -> CoreResult<()> {
        self.target.check()?;
        if self.ax.host_root(element) != Some(self.target.hwnd) {
            return Err(failed(
                "cannot establish exact HWND ownership of the UIA menu element",
            ));
        }
        Ok(())
    }

    fn resolve(&mut self, path: &[String]) -> CoreResult<Node> {
        let mut node = Node {
            element: self.menu_bar()?,
            item: None,
            path: Vec::new(),
        };
        for (depth, label) in path.iter().enumerate() {
            (self.stop)()?;
            let mut level = self.level(&node.element, &node.path)?;
            if level.items.is_empty() {
                return Err(unexposed());
            }
            let index = match_index(&level.items, label)?;
            let item = level.items.swap_remove(index);
            require_enabled(&item)?;
            if depth + 1 < path.len() && !item.has_submenu {
                return Err(failed(format!("menu item '{}' has no submenu", item.title)));
            }
            node = Node {
                element: level.elements.swap_remove(index),
                path: item.path.clone(),
                item: Some(item),
            };
        }
        Ok(node)
    }

    pub fn items(&mut self, path: &[String]) -> CoreResult<Vec<MenuItem>> {
        let node = self.resolve(path)?;
        if let Some(item) = &node.item {
            require_enabled(item)?;
            if !item.has_submenu {
                return Err(failed(
                    "the requested menu path is a leaf command, not a submenu",
                ));
            }
        }
        let level = self.level(&node.element, &node.path)?;
        if level.items.is_empty() {
            return Err(unexposed());
        }
        self.target.attached(0)?;
        Ok(level.items)
    }

    pub fn select(&mut self, path: &[String]) -> CoreResult<()> {
        let original = self.resolve(path)?;
        require_command(original.item.as_ref().ok_or_else(unexposed)?)?;
        let current = self.resolve(path)?;
        require_command(current.item.as_ref().ok_or_else(unexposed)?)?;
        if original.path != current.path
            || !self
                .automation
                .compare_elements(&original.element, &current.element)
                .map_err(uia_error)?
        {
            return Err(failed("UIA menu changed; no command was dispatched"));
        }
        let command = super::uia_command::Command::new(&current.element)?;
        let fresh = self.describe(&current.element, &current.path[..current.path.len() - 1])?;
        require_command(&fresh)?;
        if fresh.path != current.path {
            return Err(failed(
                "UIA menu command changed; no command was dispatched",
            ));
        }
        self.owns(&current.element)?;
        self.target.pattern_safe()?;
        self.target.attached(0)?;
        (self.stop)()?;
        command.run()
    }
}
