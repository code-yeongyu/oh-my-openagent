use senpi_desktop_core::error::CoreResult;

use crate::delivery::{text_steps, TextUnit};

pub(super) fn run_text_steps(
    text: &str,
    check_stop: &dyn Fn() -> CoreResult<()>,
    mut send: impl FnMut(TextUnit) -> CoreResult<()>,
    delivered: &mut dyn FnMut(),
) -> CoreResult<()> {
    for (unit, scalars) in text_steps(text) {
        check_stop()?;
        send(unit)?;
        for _ in 0..scalars {
            delivered();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
