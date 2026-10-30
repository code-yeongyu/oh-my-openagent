//! A click with a menu path: the click is delivered, the menu it opens is
//! found among the target's pop-up-level windows, the path is chosen in it,
//! and the menu is closed before the call returns.

use core_graphics::event::CGEventFlags;
use senpi_desktop_core::backend::{DeliveryMode, MenuChoice, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::menus::open_menu::{guard, settle_with, watch_timeout, Press, PressChecks};
use senpi_desktop_core::types::Target;

use super::held::{Held, KeyRoute};
use super::{
    background, cgevent, global, guard as policy, keys, resolve_window, window_identity, MacInput,
};
use crate::ax::open_menu::{app_pid_at, still_behind, AxMenus};
use crate::capture::{self, MacCapture};
use crate::skylight;

impl MacInput {
    pub(crate) fn pointer_menu(
        &mut self,
        target: &Target,
        event: PointerEvent,
        mode: DeliveryMode,
        capture: &MacCapture,
        choice: MenuChoice<'_>,
    ) -> CoreResult<()> {
        let _request = self.held.request();
        let Target::Window(id) = target else {
            return Err(DesktopError::invalid_target(
                "the menu option needs a window target",
            ));
        };
        let PointerEvent::Click { x, y, button, .. } = &event else {
            return Err(DesktopError::invalid_target(
                "the menu option goes with a click",
            ));
        };
        let window = resolve_window(capture, id)?;
        let (pid, wid) = window_identity(&window)?;
        let app_pid = app_pid_at(*x, *y).unwrap_or(pid);
        let timeout = watch_timeout(&event);
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
                    Some(choice.path),
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
                    Some(choice.path),
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
