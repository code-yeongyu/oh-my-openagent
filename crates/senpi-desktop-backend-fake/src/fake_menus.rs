//! [`Menus`] over one window of the fake's scripted context menus; a node is
//! the index path from the menu's root to an item. The clock is virtual, so
//! a menu that never appears costs no wall time.

use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::menus::open_menu::{Entry, MenuWindow, Menus};

use crate::fake::FakeBackend;
use crate::scenario::FakeMenuNode;
use crate::sink::SinkOp;

pub(crate) struct FakeMenus<'a> {
    fake: &'a mut FakeBackend,
    window: &'a str,
    epoch: Instant,
    elapsed: Duration,
}

impl<'a> FakeMenus<'a> {
    pub(crate) fn new(fake: &'a mut FakeBackend, window: &'a str) -> Self {
        Self {
            fake,
            window,
            epoch: Instant::now(),
            elapsed: Duration::ZERO,
        }
    }

    fn nodes_at(&self, path: &[usize]) -> Option<&[FakeMenuNode]> {
        let mut nodes = self.fake.context_menus.get(self.window)?.as_slice();
        for &index in path {
            nodes = nodes.get(index)?.children.as_slice();
        }
        Some(nodes)
    }

    fn titles(&self, path: &[usize]) -> Vec<String> {
        let mut nodes = self
            .fake
            .context_menus
            .get(self.window)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let mut titles = Vec::with_capacity(path.len());
        for &index in path {
            let Some(node) = nodes.get(index) else { break };
            titles.push(node.title.clone());
            nodes = node.children.as_slice();
        }
        titles
    }

    fn close(&mut self) {
        if self.fake.open_menu.take().is_some() {
            self.fake.record(SinkOp::MenuClosed {
                window: self.window.to_owned(),
            });
        }
    }
}

impl Menus for FakeMenus<'_> {
    type Node = Vec<usize>;

    fn windows(&mut self) -> Option<Vec<MenuWindow>> {
        Some(self.fake.menu_windows(self.window))
    }

    fn locate(&mut self, _window: MenuWindow) -> Option<Self::Node> {
        Some(Vec::new())
    }

    fn items(&mut self, menu: &Self::Node) -> CoreResult<Vec<Entry<Self::Node>>> {
        let nodes = self
            .nodes_at(menu)
            .ok_or_else(|| DesktopError::ax_failed("the scripted menu has no such level"))?;
        Ok(nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| !node.title.is_empty())
            .map(|(index, node)| {
                let mut at = menu.clone();
                at.push(index);
                Entry {
                    title: node.title.clone(),
                    enabled: node.enabled,
                    submenu: (!node.children.is_empty()).then(|| at.clone()),
                    node: at,
                }
            })
            .collect())
    }

    fn press(&mut self, item: &Self::Node) -> CoreResult<()> {
        let path = self.titles(item);
        self.fake.record(SinkOp::MenuChosen {
            window: self.window.to_owned(),
            path,
        });
        self.fake.open_menu = None;
        Ok(())
    }

    fn cancel(&mut self, _menu: &Self::Node) -> CoreResult<()> {
        self.close();
        Ok(())
    }

    fn escape(&mut self) -> CoreResult<()> {
        self.close();
        Ok(())
    }

    fn wait(&mut self, interval: Duration) {
        self.elapsed += interval;
    }

    fn now(&mut self) -> Instant {
        self.epoch + self.elapsed
    }
}
