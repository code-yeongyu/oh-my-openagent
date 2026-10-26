//! Release ownership is independent of the backend's foreground/AX scope.
use super::{MacInput, cgevent, global, held::Held, keys};
use core_graphics::{event::CGEventFlags, event_source::CGEventSource};
use senpi_desktop_core::{backend::EmergencyRelease, error::CoreResult};
use std::sync::Arc;

impl MacInput {
    pub(crate) fn emergency_release(&self) -> Arc<dyn EmergencyRelease> {
        Arc::new(self.held.clone())
    }

    pub(crate) fn release_all(&mut self) -> CoreResult<()> {
        release(&self.source, &mut self.held)
    }
}

impl EmergencyRelease for Held {
    fn release_all(&self) -> CoreResult<()> {
        // Foreground preparation precedes key_down/button_down bookkeeping.
        // An empty ledger therefore needs no key-up and never waits for prep.
        if self.is_empty() {
            return Ok(());
        }
        let source = cgevent::event_source()?;
        release(&source, &mut self.clone())
    }
}

fn release(source: &CGEventSource, held: &mut Held) -> CoreResult<()> {
    // Never hold the ledger mutex across a native post. Failed releases remain
    // tracked, including a regular release stalled while the stop worker runs.
    let (keys, buttons) = held.snapshot();
    let mut first_error = None;
    for key in keys {
        if let Err(error) = keys::post_key(
            source,
            held,
            key.code,
            key.text.as_deref(),
            false,
            CGEventFlags::CGEventFlagNull,
            key.route,
        ) {
            first_error.get_or_insert(error);
        }
    }
    for button in buttons {
        match global::release_button(source, &button) {
            Ok(()) => held.button_up(&button.route, button.button),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}
