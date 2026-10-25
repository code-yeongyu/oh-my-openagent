use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::holds::{with_held, HoldControl, MouseHold};
use senpi_desktop_core::keys::KeyName;
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
                            at: DesktopPoint { x: hold.x, y: hold.y },
                            button,
                            down,
                            mode,
                        });
                        backend.begin(if down { FakeMethod::MousePress } else { FakeMethod::MouseRelease })
                    },
                    |_| (control.wait)(),
                )
            },
        )
    }

    fn hold_key(&mut self, target: &Target, key: KeyName, down: bool, mode: DeliveryMode) -> CoreResult<()> {
        // Record before the fault: a failed native press may have delivered
        // part of its input, so its release must still be attempted.
        self.record(SinkOp::HeldKey { target: target.clone(), key, down, mode });
        self.begin(if down { FakeMethod::KeyPress } else { FakeMethod::KeyRelease })
    }
}
