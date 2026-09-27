//! Text input: one foreground focus guard for the entire request, with
//! interruption between complete Unicode scalars.

use enigo::Keyboard;
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::types::Target;

use super::dispatch::{enigo_error, utf16_units, Win32Input};
use super::{background, system};

impl Win32Input {
    pub(crate) fn type_text(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        match (target, mode) {
            (Target::Desktop, _) => self.enigo.text(text).map_err(enigo_error),
            (Target::Window(id), DeliveryMode::Foreground) => {
                self.with_foreground(id, |_| system::unicode_text(utf16_units(text)))
            }
            (Target::Window(id), DeliveryMode::Background) => {
                background::post_text(id, self.integrity, text)
            }
        }
    }

    pub(crate) fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        let send = |character: char, input: &mut Self| {
            let text = character.to_string();
            match (target, mode) {
                (Target::Desktop, _) => input.enigo.text(&text).map_err(enigo_error),
                (Target::Window(_), DeliveryMode::Foreground) => {
                    system::unicode_text(utf16_units(&text))
                }
                (Target::Window(id), DeliveryMode::Background) => {
                    background::post_text(id, input.integrity, &text)
                }
            }
        };
        match (target, mode) {
            (Target::Window(id), DeliveryMode::Foreground) => self.with_foreground(id, |input| {
                for character in text.chars() {
                    check_stop()?;
                    send(character, input)?;
                    delivered();
                }
                Ok(())
            }),
            _ => {
                for character in text.chars() {
                    check_stop()?;
                    send(character, self)?;
                    delivered();
                }
                Ok(())
            }
        }
    }
}
