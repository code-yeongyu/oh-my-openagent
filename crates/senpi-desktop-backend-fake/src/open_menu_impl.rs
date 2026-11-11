//! The fake's scripted context menus, settled through core's shared
//! open-menu state machine: a menu-opening press on a window with a
//! `context_menus` entry leaves that menu open, and `settle_with` chooses in
//! it or lists and closes it exactly as it does on macOS. A window that is
//! not focused is "in the background" here, like an application behind the
//! user's.

use senpi_desktop_core::ax::{native_action_name, AxHandle};
use senpi_desktop_core::backend::{Backend, DeliveryMode, MenuChoice, MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::menus::open_menu::{
    guard, may_open, may_open_context_menu, menu_watch, opens_menu, settle_with, MenuWindow, Press,
    PressChecks, Watch, CONTROL_MENU_TIMEOUT,
};
use senpi_desktop_core::protocol_results::MenuReport;
use senpi_desktop_core::types::Target;

use crate::ax_tree::node_id;
use crate::fake::FakeBackend;
use crate::fake_menus::FakeMenus;

/// The one menu window the fake shows for an open context menu.
const MENU_WINDOW: MenuWindow = MenuWindow(1);

fn holds() -> CoreResult<()> {
    Ok(())
}

/// The one press a menu-opening gesture becomes (D1): a multi-click, a drag
/// or a hold on a menu control opens the menu on its first press, so only
/// that press is delivered.
fn single_press(ev: PointerEvent) -> PointerEvent {
    match ev {
        PointerEvent::Click {
            x,
            y,
            button,
            modifiers,
            ..
        } => PointerEvent::Click {
            x,
            y,
            button,
            count: 1,
            modifiers,
        },
        PointerEvent::Drag {
            path,
            button,
            modifiers,
        } => {
            let (x, y) = path.first().copied().unwrap_or_default();
            PointerEvent::Click {
                x,
                y,
                button,
                count: 1,
                modifiers,
            }
        }
        other @ (PointerEvent::Move { .. } | PointerEvent::Scroll { .. }) => other,
    }
}

impl FakeBackend {
    pub(crate) fn pointer_menu_impl(
        &mut self,
        target: &Target,
        ev: PointerEvent,
        frame: &FrameGeometry,
        mode: DeliveryMode,
        choice: MenuChoice<'_>,
    ) -> CoreResult<Option<MenuReport>> {
        let Target::Window(id) = target else {
            if choice.path.is_some() {
                return Err(DesktopError::invalid_target(
                    "the menu option needs a window target",
                ));
            }
            return self.pointer(target, ev, frame, mode).map(|()| None);
        };
        let window = self.window(id)?.clone();
        let background = mode == DeliveryMode::Background && !window.focused;
        let opens = may_open_context_menu(&ev) || self.presses_menu_control(&ev);
        let Some(timeout) = menu_watch(&ev, background, choice.path.is_some(), || opens) else {
            return self.pointer(target, ev, frame, mode).map(|()| None);
        };
        let ev = single_press(ev);
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
        let watch = choice.path.map_or(Watch::ListAndClose, Watch::Choose);
        guard(
            self,
            press,
            Some(&before),
            watch,
            |fake| {
                fake.pointer(target, ev, frame, mode)?;
                if opens {
                    fake.open_if_scripted(&window.id);
                }
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
    ) -> CoreResult<Option<MenuReport>> {
        let node = node_id(h)?;
        let Some(window) = self.ax_tree.window_of(node)? else {
            return Err(DesktopError::ax_failed(
                "the element's window is unknown, so its menu could not be watched",
            ));
        };
        let background = !self.window(&window)?.focused;
        let opens = may_open(action, || {
            self.ax_tree.props(node).ok().map(|props| props.native_role)
        });
        if choice.path.is_none() && !(background && opens) {
            return senpi_desktop_core::ax::AxBackend::perform(self, h, action).map(|()| None);
        }
        let native = native_action_name(action);
        let before = self.menu_windows(&window);
        let checks = PressChecks {
            stop: choice.check_stop,
            holds: &holds,
        };
        let watch = choice.path.map_or(Watch::ListAndClose, Watch::Choose);
        guard(
            self,
            Press::Action(&native),
            Some(&before),
            watch,
            |fake| {
                senpi_desktop_core::ax::AxBackend::perform(fake, h, action)?;
                if opens {
                    fake.open_if_scripted(&window);
                }
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

    pub(crate) fn presses_menu_control(&self, ev: &PointerEvent) -> bool {
        let (x, y) = match ev {
            PointerEvent::Click {
                x,
                y,
                button: MouseButton::Left,
                ..
            } => (*x, *y),
            PointerEvent::Drag {
                path,
                button: MouseButton::Left,
                ..
            } => match path.first() {
                Some(&start) => start,
                None => return false,
            },
            PointerEvent::Click { .. }
            | PointerEvent::Drag { .. }
            | PointerEvent::Move { .. }
            | PointerEvent::Scroll { .. } => return false,
        };
        self.ax_tree
            .element_at(x, y)
            .and_then(|node| self.ax_tree.props(node).ok())
            .is_some_and(|props| opens_menu(Some(&props.native_role)))
    }

    fn open_if_scripted(&mut self, window: &str) {
        if self.context_menus.contains_key(window) {
            self.open_menu = Some(window.to_owned());
        }
    }

    pub(crate) fn menu_windows(&self, window: &str) -> Vec<MenuWindow> {
        if self.open_menu.as_deref() == Some(window) {
            vec![MENU_WINDOW]
        } else {
            Vec::new()
        }
    }
}
