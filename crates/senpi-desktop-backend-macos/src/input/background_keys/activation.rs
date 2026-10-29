//! Refusal and activation are one ordered preparation step.

use senpi_desktop_core::error::CoreResult;

use crate::ax::{KeyDestination, KeyFocus};
use crate::input::key_route::{
    attached_under, key_refusal, unmapped_keyboard_refusal, KeyboardConflict,
};

pub(super) fn activate_target(
    pid: libc::pid_t,
    wid: u32,
    conflict: Option<KeyboardConflict>,
    focus: impl FnOnce() -> KeyFocus,
    parent_of: impl Fn(u32) -> Option<u32>,
    activate: impl FnOnce() -> CoreResult<()>,
) -> CoreResult<()> {
    if conflict == Some(KeyboardConflict::Unmapped) {
        return Err(unmapped_keyboard_refusal(wid));
    }
    let destination = focus().destination(pid, wid, &parent_of);
    if let KeyDestination::Other(Some(other)) = destination {
        if attached_under(other, &parent_of, |parent| parent == wid) {
            return Err(key_refusal(wid, destination, conflict, parent_of));
        }
    }
    activate()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use senpi_desktop_core::error::ErrorCode;

    use crate::ax::FocusedWindow;

    use super::*;

    #[test]
    fn an_early_sheet_refusal_never_activates_the_target() {
        for focused in [41, 42] {
            let probes = Cell::new(0);
            let activations = Cell::new(0);
            let result = activate_target(
                7,
                41,
                None,
                || {
                    probes.set(probes.get() + 1);
                    KeyFocus {
                        window: FocusedWindow::Id(focused),
                        element_window: Some(42),
                        element_mapped: true,
                        element_kind: crate::ax::ElementWindowKind::Sheet,
                    }
                },
                |id| (id == 42).then_some(41),
                || {
                    activations.set(activations.get() + 1);
                    Ok(())
                },
            );
            assert_eq!(result.unwrap_err().code, ErrorCode::InvalidTarget);
            assert_eq!(probes.get(), 1);
            assert_eq!(activations.get(), 0);
        }
    }
}
