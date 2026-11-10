//! `ax.keyChord`: a key chord pressed in one element without taking the
//! user's focus. Chords are never inserted: the backend sends them as keys
//! once the element holds its application's keyboard focus, never
//! unconfirmed, and the refusal names where the focus is, as `ax.typeText`
//! does (ported from oh-my-pi 0838d2ab44 element `press(chord)`).

use senpi_desktop_core::backend::ElementDelivery;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::keys::parse_keys;
use senpi_desktop_core::protocol_params::AxKeyChordParams;
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::pointer::ParsedPointerOptions;
use crate::request::Response;
use crate::worker::{Audited, Worker};
use crate::worker_input::{delivery, interrupted};

impl Worker {
    pub(crate) fn ax_key_chord(
        &mut self,
        params: &AxKeyChordParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation {
            keys: Some(&params.keys),
            ..Mutation::new(
                MutatingAction::AxKeyChord,
                self.ref_target(&params.ref_),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        self.mutate(&mutation, cancelled, |worker| {
            let keys = parse_keys(&params.keys)?;
            if keys.is_empty() {
                return Err(DesktopError::invalid_key("key chord must not be empty"));
            }
            let mode = delivery(params.opts.as_ref())?;
            let handle = worker.registry.resolve(&params.ref_)?;
            let check_stop = || interrupted(&supervisor, &policy, cancelled, "pressing keys in the element");
            match worker.backend()?.ax_key_chord(&handle, &keys, mode, &check_stop)? {
                ElementDelivery::Delivered(_) => Ok(Response::Unit),
                ElementDelivery::Unfocused(focus) => Err(worker.element_focus_refusal(&params.ref_, focus, mode)),
            }
        })
    }
}
