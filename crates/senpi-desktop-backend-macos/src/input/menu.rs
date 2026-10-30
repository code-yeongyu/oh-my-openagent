//! A press that may open a menu: the press is delivered, the menu it opens
//! is found among the target's pop-up-level windows, the path is chosen in
//! it or its items are read, and the menu is closed before the call returns.
//! In the background every menu-opening press is watched (D1): a secondary
//! press, a left press on a menu button or popup button, and any press with a
//! path; a multi-click, a drag or a hold on a menu control is delivered as
//! the one press that opens the menu.

use core_graphics::event::CGEventFlags;
use senpi_desktop_core::backend::{DeliveryMode, MenuChoice, MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::holds::MouseHold;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::menus::open_menu::{
    guard, menu_watch, settle_with, Press, PressChecks, Watch,
};
use senpi_desktop_core::protocol_results::MenuReport;
use senpi_desktop_core::types::{DesktopWindow, Target};

use super::held::{Held, KeyRoute};
use super::{
    background, cgevent, global, guard as policy, keys, resolve_window, window_identity, MacInput,
};
use crate::ax::open_menu::{app_pid_at, opens_menu_at, still_behind, AxMenus};
use crate::capture::{self, MacCapture};
use crate::{front_app, skylight};

/// The one press a menu-opening gesture becomes: a multi-click, a drag or a
/// hold on a menu control opens the menu on its first press.
fn single_press(event: &PointerEvent) -> Option<PointerEvent> {
    match event {
        PointerEvent::Click {
            x,
            y,
            button,
            modifiers,
            ..
        } => Some(PointerEvent::Click {
            x: *x,
            y: *y,
            button: *button,
            count: 1,
            modifiers: *modifiers,
        }),
        PointerEvent::Drag {
            path,
            button,
            modifiers,
        } => path.first().map(|&(x, y)| PointerEvent::Click {
            x,
            y,
            button: *button,
            count: 1,
            modifiers: *modifiers,
        }),
        PointerEvent::Move { .. } | PointerEvent::Scroll { .. } => None,
    }
}

/// Whether a left press at the event's start lands on a menu button or popup
/// button of `pid`. The front process is read before and after the
/// accessibility probe, which can block while the app is busy: a user who
/// picked the target meanwhile makes it the front app, whose menus stay.
fn on_menu_control(event: &PointerEvent, pid: libc::pid_t) -> bool {
    let (x, y) = match single_press(event) {
        Some(PointerEvent::Click {
            x,
            y,
            button: MouseButton::Left,
            ..
        }) => (x, y),
        _ => return false,
    };
    let front_before = front_app::current_front_pid();
    let on_control = opens_menu_at(pid, x, y);
    on_control && front_app::current_front_pid() == front_before
}

impl MacInput {
    pub(crate) fn pointer_menu(
        &mut self,
        target: &Target,
        event: PointerEvent,
        mode: DeliveryMode,
        capture: &MacCapture,
        choice: MenuChoice<'_>,
    ) -> CoreResult<Option<MenuReport>> {
        let Target::Window(id) = target else {
            if choice.path.is_some() {
                return Err(DesktopError::invalid_target(
                    "the menu option needs a window target",
                ));
            }
            return self.pointer(target, event, mode, capture).map(|()| None);
        };
        let window = resolve_window(capture, id)?;
        let (pid, wid) = window_identity(&window)?;
        let background =
            mode == DeliveryMode::Background && front_app::current_front_pid() != Some(pid);
        let Some(timeout) = menu_watch(&event, background, choice.path.is_some(), || {
            on_menu_control(&event, pid)
        }) else {
            return self.pointer(target, event, mode, capture).map(|()| None);
        };
        let Some(event) = single_press(&event) else {
            return self.pointer(target, event, mode, capture).map(|()| None);
        };
        let PointerEvent::Click { x, y, button, .. } = &event else {
            return Err(DesktopError::internal("a watched press is a click"));
        };
        let _request = self.held.request();
        let app_pid = app_pid_at(*x, *y).unwrap_or(pid);
        let before = capture::menu_windows(pid).ok_or_else(|| {
            DesktopError::background_unavailable(format!(
                "cannot list the open menus of window {} ({}), so a menu this click opens could not be closed; \
                 nothing was sent",
                window.id, window.app,
            ))
        })?;
        let press = Press::Pointer {
            kind: "click",
            id: &window.id,
            app: &window.app,
        };
        let watch = choice.path.map_or(Watch::ListAndClose, Watch::Choose);
        let button = *button;
        match mode {
            DeliveryMode::Background => self.background(|this| {
                let holds = || still_behind(pid);
                let checks = PressChecks {
                    stop: choice.check_stop,
                    holds: &holds,
                };
                guard(
                    this,
                    press,
                    Some(&before),
                    watch,
                    |this| {
                        policy::guard(&window, "click", Some(button))?;
                        if !window.focused {
                            skylight::activate_without_raise(pid, wid)?;
                            this.last_activated = Some((pid, wid));
                        }
                        background::pointer(
                            &this.source,
                            &mut this.held,
                            pid,
                            wid,
                            &window,
                            event,
                            &this.overlay,
                        )
                    },
                    |_, before, path| {
                        settle_with(
                            &mut AxMenus::new(pid, app_pid),
                            before,
                            path,
                            timeout,
                            &checks,
                        )
                    },
                )
            }),
            DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                crate::ax::prepare_foreground_input(&window)?;
                crate::ax::ensure_points_owned(&window, pid, wid, &event)?;
                let holds = || Ok(());
                let checks = PressChecks {
                    stop: choice.check_stop,
                    holds: &holds,
                };
                guard(
                    self,
                    press,
                    Some(&before),
                    watch,
                    |this| global::pointer(&this.source, &mut this.held, event, &this.overlay),
                    |_, before, path| {
                        settle_with(
                            &mut AxMenus::new(pid, app_pid),
                            before,
                            path,
                            timeout,
                            &checks,
                        )
                    },
                )
            }),
        }
    }

    /// A background mouse hold that would open a menu (a secondary button, a
    /// Control-left press, or a left press on a menu button or popup button):
    /// the menu would open on the press and take the user's keyboard for the
    /// whole hold, so the hold is delivered as the one press that opens it,
    /// with the hold's modifiers, and the menu is read and closed (D1).
    /// `Some` when it was.
    pub(super) fn hold_as_menu_press(
        &mut self,
        window: &DesktopWindow,
        hold: &MouseHold<'_>,
        capture: &MacCapture,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<Option<()>> {
        let (pid, _) = window_identity(window)?;
        let press = hold.menu_press();
        let background = front_app::current_front_pid() != Some(pid);
        if menu_watch(&press, background, false, || on_menu_control(&press, pid)).is_none() {
            return Ok(None);
        }
        let choice = MenuChoice {
            path: None,
            check_stop,
        };
        self.pointer_menu(
            &Target::Window(window.id.clone()),
            press,
            DeliveryMode::Background,
            capture,
            choice,
        )?;
        Ok(Some(()))
    }
}

/// Posts Escape to `pid` through the per-process route, which closes the
/// menu it has open. The pair is not tracked as held: both halves go out
/// back to back, and a failed post reports itself.
pub(crate) fn post_escape(pid: libc::pid_t) -> CoreResult<()> {
    let source = cgevent::event_source()?;
    let mut held = Held::default();
    let code = keys::key_code(KeyName::Escape)?;
    for down in [true, false] {
        keys::post_key(
            &source,
            &mut held,
            code,
            None,
            down,
            CGEventFlags::CGEventFlagNull,
            KeyRoute::Process(pid),
        )?;
    }
    Ok(())
}
