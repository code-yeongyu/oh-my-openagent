//! Bounded holds keep the selected native route through their cleanup.

use senpi_desktop_core::backend::{DeliveryMode, Modifiers};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::holds::{with_held, HoldControl, MouseHold};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopWindow, Target};

use super::cgevent::{button_types, click_group_id, modifier_flags, point};
use super::held::{ButtonRoute, HeldButton, KeyRoute};
use super::{global, guard, keys, post, resolve_window, window_identity, MacInput};
use crate::{capture::MacCapture, skylight};

impl MacInput {
    pub(crate) fn hold_keys(
        &mut self, target: &Target, keys: &[KeyName], mode: DeliveryMode,
        capture: &MacCapture, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        self.hold_target(target, mode, capture, None, |this, route, _| {
            this.keys_held(keys, route, control, |_| (control.wait)())
        })
    }

    pub(crate) fn hold_mouse(
        &mut self, target: &Target, hold: &MouseHold<'_>, mode: DeliveryMode,
        capture: &MacCapture, control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        self.hold_target(target, mode, capture, Some(hold), |this, key_route, window| {
            let route = match (window, mode) {
                (Some(window), DeliveryMode::Background) => {
                    let (pid, wid) = window_identity(window)?;
                    ButtonRoute::Window(pid, wid, post::local_point(window, hold.x, hold.y))
                }
                _ => ButtonRoute::Global(point(hold.x, hold.y)?),
            };
            let button = HeldButton { route, button: hold.button };
            this.keys_held(hold.keys, key_route, control, |this| {
                with_held(
                    this, &[&button], control.check,
                    |this, button, down| this.hold_button(button, hold, window, down),
                    |_| (control.wait)(),
                )
            })
        })
    }

    fn hold_target(
        &mut self, target: &Target, mode: DeliveryMode, capture: &MacCapture,
        mouse: Option<&MouseHold<'_>>,
        action: impl FnOnce(&mut Self, KeyRoute, Option<&DesktopWindow>) -> CoreResult<()>,
    ) -> CoreResult<()> {
        match target {
            Target::Desktop | Target::Display(_) => action(self, KeyRoute::Global, None),
            Target::Window(id) => {
                let window = resolve_window(capture, id)?;
                let (pid, wid) = window_identity(&window)?;
                match mode {
                    DeliveryMode::Background => {
                        self.ensure_background_ready()?;
                        guard::guard(&window, if mouse.is_some() { "click" } else { "keyboard" },
                            mouse.map(|hold| hold.button))?;
                        if mouse.is_none_or(|hold| !hold.keys.is_empty()) {
                            guard::prepare_keys(&window, pid, wid, capture)?;
                            self.last_activated = Some((pid, wid));
                        } else if !window.focused {
                            skylight::activate_without_raise(pid, wid)?;
                            self.last_activated = Some((pid, wid));
                        }
                        action(self, KeyRoute::Process(pid), Some(&window))
                    }
                    DeliveryMode::Foreground => skylight::with_foreground(pid, || {
                        crate::ax::prepare_foreground_input(&window)?;
                        if let Some(hold) = mouse {
                            crate::ax::ensure_points_owned(&window, pid, wid,
                                &senpi_desktop_core::backend::PointerEvent::Move { x: hold.x, y: hold.y })?;
                        }
                        action(self, KeyRoute::Global, Some(&window))
                    }),
                }
            }
        }
    }

    fn keys_held(
        &mut self, held_keys: &[KeyName], route: KeyRoute, control: &HoldControl<'_>,
        operation: impl FnOnce(&mut Self) -> CoreResult<()>,
    ) -> CoreResult<()> {
        let codes = held_keys.iter().map(|&key| keys::key_code(key).map(|code| (key, code)))
            .collect::<CoreResult<Vec<_>>>()?;
        with_held(
            &mut (self, Modifiers::default()), &codes, control.check,
            |(this, modifiers), (key, code), down| {
                keys::update_modifier(modifiers, key, down);
                keys::post_key(&this.source, &mut this.held, code, None, down,
                    modifier_flags(*modifiers), route)
            },
            |(this, _)| operation(this),
        )
    }

    fn hold_button(
        &mut self, button: &HeldButton, hold: &MouseHold<'_>,
        window: Option<&DesktopWindow>, down: bool,
    ) -> CoreResult<()> {
        if !down {
            global::release_button(&self.source, button)?;
            self.held.button_up(&button.route, button.button);
            return Ok(());
        }
        self.held.button_down(button.clone());
        let (cg_button, event, _, _, number) = button_types(button.button);
        let mut modifiers = Modifiers::default();
        for &key in hold.keys {
            keys::update_modifier(&mut modifiers, key, true);
        }
        let flags = modifier_flags(modifiers);
        match button.route {
            ButtonRoute::Global(_) => global::post_global_mouse(
                &self.source, event, cg_button, hold.x, hold.y, 1, number, flags),
            ButtonRoute::Window(pid, wid, _) => {
                let window = window.ok_or_else(|| senpi_desktop_core::error::DesktopError::internal(
                    "background hold has no captured window"))?;
                post::post_mouse(&self.source, pid, wid, window, event, cg_button,
                    hold.x, hold.y, 3, 1, number, click_group_id(),
                    flags)
            }
        }
    }
}
