//! Menus listed and selected without moving focus: the app's `AXMenuBar` is read through its
//! children (no menu is opened), and a selection presses only the leaf item. Focus is never
//! written and the app is never raised.

use omo_computer_core::ax::{Slice, SLICE_MS};
use omo_computer_core::backend::{BackendResult, Delivered, Refusal};
use omo_computer_core::error::{EngineCode, Reason};

use super::reader::{MacAx, CHILD_BATCH};
use super::seam::{AxServer, AxStatus, Element};

/// Submenu depth listed at most.
const MAX_MENU_DEPTH: usize = 4;

/// One selectable menu item by its title path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuItem {
    pub path: Vec<String>,
    pub enabled: bool,
}

struct Entry {
    element: Element,
    title: String,
    enabled: bool,
    submenu: Option<Element>,
}

impl<S: AxServer> MacAx<S> {
    fn entries(&mut self, menu: Element) -> Vec<Entry> {
        let Slice::Read(children) = self.server.children(menu, 0, CHILD_BATCH, SLICE_MS) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for element in children {
            let Slice::Read(Some(item)) = self.server.read(element, SLICE_MS) else {
                continue;
            };
            let Some(title) = item.title.filter(|t| !t.is_empty()) else {
                continue;
            };
            let submenu = if item.child_count > 0 {
                match self.server.children(element, 0, 1, SLICE_MS) {
                    Slice::Read(menus) => menus.first().copied(),
                    Slice::Hung => None,
                }
            } else {
                None
            };
            out.push(Entry {
                element,
                title,
                enabled: item.enabled.unwrap_or(true),
                submenu,
            });
        }
        out
    }

    fn bar(&mut self, pid: u32) -> BackendResult<Element> {
        self.server.menu_bar(pid).ok_or(Refusal::new(
            EngineCode::AxUnsupported,
            Reason::SnapshotUnsupported,
        ))
    }

    /// Every leaf item of `pid`'s menu bar, in menu order.
    ///
    /// # Errors
    /// `AxUnsupported` when the app has no readable menu bar.
    pub fn menu(&mut self, pid: u32) -> BackendResult<Vec<MenuItem>> {
        let bar = self.bar(pid)?;
        let mut out = Vec::new();
        self.collect(bar, &[], &mut out);
        Ok(out)
    }

    fn collect(&mut self, menu: Element, path: &[String], out: &mut Vec<MenuItem>) {
        for entry in self.entries(menu) {
            let mut item_path = path.to_vec();
            item_path.push(entry.title);
            match entry.submenu {
                Some(submenu) if item_path.len() < MAX_MENU_DEPTH => {
                    self.collect(submenu, &item_path, out)
                }
                Some(_) => {}
                None => out.push(MenuItem {
                    path: item_path,
                    enabled: entry.enabled,
                }),
            }
        }
    }

    /// Presses the leaf at `path` and nothing else.
    ///
    /// # Errors
    /// `InvalidTarget` for a path that names no item, `AxFailed` when the press failed.
    pub fn select_menu(&mut self, pid: u32, path: &[&str]) -> BackendResult<Delivered> {
        let mut menu = self.bar(pid)?;
        for (depth, title) in path.iter().enumerate() {
            let entry = self
                .entries(menu)
                .into_iter()
                .find(|e| e.title == *title)
                .ok_or(Refusal::bare(EngineCode::InvalidTarget))?;
            match (entry.submenu, depth + 1 == path.len()) {
                (_, true) => {
                    return match self.server.perform(entry.element, "AXPress") {
                        AxStatus::Done => Ok(Delivered { count: 1, of: 1 }),
                        _ => Err(Refusal::bare(EngineCode::AxFailed)),
                    }
                }
                (Some(submenu), false) => menu = submenu,
                (None, false) => return Err(Refusal::bare(EngineCode::InvalidTarget)),
            }
        }
        Err(Refusal::bare(EngineCode::InvalidTarget))
    }
}
