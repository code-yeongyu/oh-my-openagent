use senpi_desktop_core::backend::{DeliveryMode, MenuChoice};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::holds::{with_held, HoldControl, MouseHold};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::menus::open_menu::menu_watch;
use senpi_desktop_core::types::{DesktopPoint, Target};

use crate::{FakeBackend, FakeMethod, SinkOp};

impl FakeBackend {
    pub(crate) fn hold_keys_impl(
        &mut self,
        target: &Target,
        keys: &[KeyName],
        mode: DeliveryMode,
        control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        self.input_gate(target, mode)?;
        self.deliver_focus(target, mode);
        with_held(
            self,
            keys,
            control.check,
            |backend, key, down| backend.hold_key(target, key, down, mode),
            |_| (control.wait)(),
        )
    }

    pub(crate) fn hold_mouse_impl(
        &mut self,
        target: &Target,
        hold: &MouseHold<'_>,
        mode: DeliveryMode,
        control: &HoldControl<'_>,
    ) -> CoreResult<()> {
        self.input_gate(target, mode)?;
        if self
            .hold_as_menu_press(target, hold, mode, control)?
            .is_some()
        {
            return Ok(());
        }
        self.deliver_focus(target, mode);
        with_held(
            self,
            hold.keys,
            control.check,
            |backend, key, down| backend.hold_key(target, key, down, mode),
            |backend| {
                with_held(
                    backend,
                    &[hold.button],
                    control.check,
                    |backend, button, down| {
                        backend.record(SinkOp::HeldButton {
                            target: target.clone(),
                            at: DesktopPoint {
                                x: hold.x,
                                y: hold.y,
                            },
                            button,
                            down,
                            mode,
                        });
                        backend.begin(if down {
                            FakeMethod::MousePress
                        } else {
                            FakeMethod::MouseRelease
                        })
                    },
                    |_| (control.wait)(),
                )
            },
        )
    }

    /// A background hold that would open a menu (D1) is delivered as the one
    /// press that opens it, through the open-menu flow; `Some` when it was.
    fn hold_as_menu_press(
        &mut self,
        target: &Target,
        hold: &MouseHold<'_>,
        mode: DeliveryMode,
        control: &HoldControl<'_>,
    ) -> CoreResult<Option<()>> {
        let (Target::Window(id), DeliveryMode::Background) = (target, mode) else {
            return Ok(None);
        };
        let press = hold.menu_press();
        let background = !self.window(id)?.focused;
        if menu_watch(&press, background, false, || {
            self.presses_menu_control(&press)
        })
        .is_none()
        {
            return Ok(None);
        }
        let (frame, _, _) = self.frame(target)?;
        let choice = MenuChoice {
            path: None,
            check_stop: control.check,
        };
        self.pointer_menu_impl(target, press, &frame, mode, choice)?;
        Ok(Some(()))
    }

    fn hold_key(
        &mut self,
        target: &Target,
        key: KeyName,
        down: bool,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        // Record before the fault: a failed native press may have delivered
        // part of its input, so its release must still be attempted.
        self.record(SinkOp::HeldKey {
            target: target.clone(),
            key,
            down,
            mode,
        });
        self.begin(if down {
            FakeMethod::KeyPress
        } else {
            FakeMethod::KeyRelease
        })
    }
}
