//! The fake's scripted context menus, settled through core's shared
//! open-menu state machine: a menu-opening press on a window with a
//! `context_menus` entry leaves that menu open, and `settle_with` chooses in
//! it or closes it exactly as it does on macOS.

use std::time::{Duration, Instant};

use senpi_desktop_core::ax::{native_action_name, AxHandle};
use senpi_desktop_core::backend::{Backend, DeliveryMode, MenuChoice, MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::menus::open_menu::{
    guard, may_open, may_open_context_menu, opens_menu, settle_with, watch_timeout, Entry,
    MenuWindow, Menus, Press, PressChecks, CONTROL_MENU_TIMEOUT,
};
use senpi_desktop_core::types::Target;

use crate::ax_tree::node_id;
use crate::fake::FakeBackend;
use crate::scenario::FakeMenuNode;
use crate::sink::SinkOp;

/// The one menu window the fake shows for an open context menu.
const MENU_WINDOW: MenuWindow = MenuWindow(1);

fn holds() -> CoreResult<()> {
    Ok(())
}

impl FakeBackend {
    pub(crate) fn pointer_menu_impl(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
        choice: MenuChoice<'_>,
    ) -> CoreResult<()> {
        let Target::Window(id) = target else {
            return Err(DesktopError::invalid_target(
                "the menu option needs a window target",
            ));
        };
        let window = self.window(id)?.clone();
        let opens = may_open_context_menu(&ev) || self.presses_menu_control(&ev);
        let timeout = watch_timeout(&ev);
        let before = self.menu_windows(&window.id);
        let press = Press::Pointer {
            kind: "click",
            id: &window.id,
            app: &window.app,
        };
        let checks = PressChecks {
            stop: choice.check_stop,
            holds: &holds,
        };
        guard(
            self,
            press,
            Some(&before),
            Some(choice.path),
            |fake| {
                fake.pointer(target, ev, frame, mode)?;
                fake.open_if_scripted(&window.id, opens);
                Ok(())
            },
            |fake, before, path| {
                settle_with(
                    &mut FakeMenus::new(fake, &window.id),
                    before,
                    path,
                    timeout,
                    &checks,
                )
            },
        )
    }

    pub(crate) fn perform_menu_impl(
        &mut self,
        h: &AxHandle,
        action: &str,
        choice: MenuChoice<'_>,
    ) -> CoreResult<()> {
        let node = node_id(h)?;
        let Some(window) = self.ax_tree.window_of(node)? else {
            return Err(DesktopError::ax_failed(
                "the element's window is unknown, so its menu could not be watched",
            ));
        };
        let native = native_action_name(action);
        let opens = may_open(action, || {
            self.ax_tree.props(node).ok().map(|props| props.native_role)
        });
        let before = self.menu_windows(&window);
        let checks = PressChecks {
            stop: choice.check_stop,
            holds: &holds,
        };
        guard(
            self,
            Press::Action(&native),
            Some(&before),
            Some(choice.path),
            |fake| {
                senpi_desktop_core::ax::AxBackend::perform(fake, h, action)?;
                fake.open_if_scripted(&window, opens);
                Ok(())
            },
            |fake, before, path| {
                settle_with(
                    &mut FakeMenus::new(fake, &window),
                    before,
                    path,
                    CONTROL_MENU_TIMEOUT,
                    &checks,
                )
            },
        )
    }

    fn presses_menu_control(&self, ev: &PointerEvent) -> bool {
        let PointerEvent::Click {
            x,
            y,
            button: MouseButton::Left,
            ..
        } = ev
        else {
            return false;
        };
        self.ax_tree
            .element_at(*x, *y)
            .and_then(|node| self.ax_tree.props(node).ok())
            .is_some_and(|props| opens_menu(Some(&props.native_role)))
    }

    fn open_if_scripted(&mut self, window: &str, opens: bool) {
        if opens && self.context_menus.contains_key(window) {
            self.open_menu = Some(window.to_owned());
        }
    }

    fn menu_windows(&self, window: &str) -> Vec<MenuWindow> {
        if self.open_menu.as_deref() == Some(window) {
            vec![MENU_WINDOW]
        } else {
            Vec::new()
        }
    }
}

/// [`Menus`] over one window's scripted context menu; a node is the index
/// path from the menu's root to an item. The clock is virtual, so a menu
/// that never appears costs no wall time.
struct FakeMenus<'a> {
    fake: &'a mut FakeBackend,
    window: &'a str,
    epoch: Instant,
    elapsed: Duration,
}

impl<'a> FakeMenus<'a> {
    fn new(fake: &'a mut FakeBackend, window: &'a str) -> Self {
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
