//! `ax.typeText`: text typed into one element without taking the user's
//! focus. The backend inserts it through the element's own selection when the
//! element takes that, else sends keys once the element holds its
//! application's keyboard focus; keys are never sent unconfirmed, and the
//! refusal names where the focus is, with a ref (ported from oh-my-pi
//! 0838d2ab44 `element_focus_refusal`).

use senpi_desktop_core::ax::register_node;
use senpi_desktop_core::backend::{DeliveryMode, ElementDelivery, KeyboardFocus};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::protocol_params::AxTypeTextParams;
use senpi_desktop_core::protocol_results::AxInputResult;
use senpi_desktop_core::types::AxNode;
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::pointer::ParsedPointerOptions;
use crate::request::Response;
use crate::worker::{Audited, Worker};
use crate::worker_input::{delivery, interrupted};

impl Worker {
    pub(crate) fn ax_type_text(
        &mut self,
        params: &AxTypeTextParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation {
            text: Some(&params.text),
            ..Mutation::new(
                MutatingAction::AxTypeText,
                self.ref_target(&params.ref_),
                ParsedPointerOptions::requested_mode(params.opts.as_ref()),
            )
        };
        let supervisor = self.safety.supervisor.clone();
        let policy = self.stop_policy();
        self.mutate(&mutation, cancelled, |worker| {
            let mode = delivery(params.opts.as_ref())?;
            let handle = worker.registry.resolve(&params.ref_)?;
            let check_stop = || interrupted(&supervisor, &policy, cancelled, "typing into the element");
            let delivered = worker.backend()?.ax_type_text(
                &handle,
                &params.text,
                mode,
                &check_stop,
                &mut || mutation.text_delivered.set(mutation.text_delivered.get().saturating_add(1)),
            )?;
            match delivered {
                ElementDelivery::Delivered(method) => Ok(Response::AxInput(AxInputResult { method })),
                ElementDelivery::Unfocused(focus) => Err(worker.element_focus_refusal(&params.ref_, focus, mode)),
            }
        })
    }

    /// The error for keys addressed to `reference` that were never sent
    /// because the element did not take keyboard focus: where focus is now,
    /// with the focused element's node line and a ref for it.
    fn element_focus_refusal(&mut self, reference: &str, focus: KeyboardFocus, mode: DeliveryMode) -> DesktopError {
        let window = match focus.window.as_deref() {
            None => "an unidentified window".to_owned(),
            Some(id) => {
                let title = self
                    .backend()
                    .and_then(|backend| backend.windows())
                    .ok()
                    .and_then(|windows| windows.into_iter().find(|window| window.id == id))
                    .map(|window| window.title);
                match title {
                    Some(title) => format!("window {id} ({title:?})"),
                    None => format!("window {id}"),
                }
            }
        };
        let target = focus
            .window
            .clone()
            .or_else(|| self.registry.target(reference).ok())
            .unwrap_or_else(|| "desktop".to_owned());
        let element = match focus.element {
            None => "no element".to_owned(),
            Some(handle) => self
                .ax_parts()
                .and_then(|(backend, registry)| register_node(backend, registry, &target, handle))
                .map_or_else(|_| "an element that could not be read".to_owned(), |node| node_line(&node)),
        };
        let message = format!(
            "{reference} did not take keyboard focus when asked to, so no keys were sent; its application's \
             keyboard focus is in {window}, on {element}. Re-read with win.ax() or win.observe() before retrying"
        );
        match mode {
            DeliveryMode::Background => DesktopError::background_unavailable(message),
            DeliveryMode::Foreground => DesktopError::input_failed(message),
        }
    }
}

/// One node as a snapshot line names it: role, title, and its ref.
fn node_line(node: &AxNode) -> String {
    let label = node
        .title
        .as_deref()
        .or(node.description.as_deref())
        .map(|label| format!(" {label:?}"))
        .unwrap_or_default();
    format!("{}{label} [ref={}]", node.role, node.ref_)
}
