//! User intervention (#11459): the seam every mutating request passes.
//! [`admit`] runs before the request captures or sends anything and installs
//! [`check_press`] as the session thread's press check, which the backend runs
//! before every key or pointer press and every model-requested AX action or
//! write (`senpi_desktop_core::intervention::check_press`). Both let
//! everything through until the per-app record of the user's input fills
//! them.

use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::intervention::{watch, PressWatch};

/// Admits a mutating request on `target` (`desktop`, a window id, or an AX
/// ref's window key); the returned watch keeps its press check installed
/// until the request ends.
pub(crate) fn admit(_target: &str) -> CoreResult<PressWatch> {
    Ok(watch(check_press))
}

pub(crate) fn check_press() -> CoreResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::admit;

    #[test]
    fn an_admitted_request_presses_until_the_record_says_otherwise() {
        let _watch = admit("desktop").expect("admission refuses nothing yet");
        assert!(senpi_desktop_core::intervention::check_press().is_ok());
    }
}
