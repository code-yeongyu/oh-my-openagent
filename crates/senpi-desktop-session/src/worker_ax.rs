//! Accessibility requests. Refs (`eN`) resolve through the session's
//! registry; a ref older than the previous snapshot fails `StaleRef`.

use senpi_desktop_core::ax::{self, register_node};
use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_params::{AxElementAtParams, AxQueryParams, AxSnapshotParams};
use senpi_desktop_core::types::{AxNode, Target};

use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::request::Response;
use crate::worker::{Audited, Worker};

/// Attribute values longer than this are cut with an ellipsis.
const ATTRIBUTE_MAX_CHARS: usize = 200;

impl Worker {
    pub(crate) fn ax_snapshot(&mut self, params: &AxSnapshotParams) -> CoreResult<Response> {
        let window = self.window(&Target::parse(&params.target))?;
        let options = params.opts.clone().unwrap_or_default();
        let (backend, registry) = self.ax_parts()?;
        ax::snapshot(backend, registry, &window, &options).map(Response::Snapshot)
    }

    pub(crate) fn ax_query(&mut self, params: &AxQueryParams) -> CoreResult<Response> {
        let window = self.window(&Target::parse(&params.target))?;
        let (backend, registry) = self.ax_parts()?;
        ax::query(backend, registry, &window, &params.query).map(Response::Nodes)
    }

    /// Hit-test at global logical desktop coordinates; needs no capture.
    pub(crate) fn ax_element_at(&mut self, params: &AxElementAtParams) -> CoreResult<Response> {
        let target = Target::parse(&params.target);
        let (backend, registry) = self.ax_parts()?;
        ax::element_at_node(backend, registry, target.key(), params.x, params.y).map(Response::MaybeNode)
    }

    pub(crate) fn ax_focused(&mut self) -> CoreResult<Response> {
        let (backend, registry) = self.ax_parts()?;
        let node = match backend.focused_element()? {
            Some(handle) => Some(register_node(backend, registry, Target::Desktop.key(), handle)?),
            None => None,
        };
        Ok(Response::MaybeNode(node))
    }

    pub(crate) fn ax_node(&mut self, reference: &str) -> CoreResult<Response> {
        let handle = self.registry.resolve(reference)?;
        let props = self.ax_parts()?.0.props(&handle)?;
        let (x, y, width, height) = props.bounds.map_or((None, None, None, None), |bounds| {
            (
                Some(bounds.x),
                Some(bounds.y),
                Some(bounds.width),
                Some(bounds.height),
            )
        });
        Ok(Response::Node(AxNode {
            ref_: reference.to_owned(),
            role: props.role,
            native_role: props.native_role,
            title: props.title,
            value: props.value,
            description: props.description,
            enabled: props.enabled,
            focused: props.focused,
            x,
            y,
            width,
            height,
            actions: (!props.actions.is_empty()).then_some(props.actions),
            child_count: props.child_count,
        }))
    }

    pub(crate) fn ax_attributes(&mut self, reference: &str) -> CoreResult<Response> {
        let handle = self.registry.resolve(reference)?;
        let attributes = self.ax_parts()?.0.attributes(&handle)?;
        let attributes = attributes
            .into_iter()
            .map(|(name, value)| (name, truncate(value)))
            .collect();
        Ok(Response::Attributes(attributes))
    }

    pub(crate) fn ax_children(&mut self, reference: &str) -> CoreResult<Response> {
        let handle = self.registry.resolve(reference)?;
        let target = self.registry.target(reference)?;
        let (backend, registry) = self.ax_parts()?;
        let nodes = backend
            .children(&handle)?
            .into_iter()
            .map(|child| register_node(backend, registry, &target, child))
            .collect::<CoreResult<Vec<_>>>()?;
        Ok(Response::Nodes(nodes))
    }

    pub(crate) fn ax_parent(&mut self, reference: &str) -> CoreResult<Response> {
        let handle = self.registry.resolve(reference)?;
        let target = self.registry.target(reference)?;
        let (backend, registry) = self.ax_parts()?;
        let node = match backend.parent(&handle)? {
            Some(parent) => Some(register_node(backend, registry, &target, parent)?),
            None => None,
        };
        Ok(Response::MaybeNode(node))
    }

    /// The audit target of an AX request: the window its ref belongs to, or
    /// the ref itself once it expired.
    fn ref_target(&self, reference: &str) -> String {
        self.registry
            .target(reference)
            .unwrap_or_else(|_| reference.to_owned())
    }

    pub(crate) fn ax_perform(
        &mut self,
        reference: &str,
        action: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation::new(
            MutatingAction::AxPerform,
            self.ref_target(reference),
            DeliveryMode::Background,
        );
        self.mutate(&mutation, cancelled, |worker| {
            let handle = worker.registry.resolve(reference)?;
            let backend = worker.ax_parts()?.0;
            if action.eq_ignore_ascii_case("press") {
                ax::ax_press(backend, &handle)?;
            } else {
                backend.perform(&handle, action)?;
            }
            Ok(Response::Unit)
        })
    }

    pub(crate) fn ax_set_value(
        &mut self,
        reference: &str,
        value: &str,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation {
            text: Some(value),
            ..Mutation::new(
                MutatingAction::AxSetValue,
                self.ref_target(reference),
                DeliveryMode::Background,
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            let handle = worker.registry.resolve(reference)?;
            worker.ax_parts()?.0.set_value(&handle, value)?;
            Ok(Response::Unit)
        })
    }

    pub(crate) fn ax_focus(&mut self, reference: &str, cancelled: &dyn Fn() -> bool) -> CoreResult<Audited> {
        let mutation = Mutation::new(
            MutatingAction::AxFocus,
            self.ref_target(reference),
            DeliveryMode::Background,
        );
        self.mutate(&mutation, cancelled, |worker| {
            let handle = worker.registry.resolve(reference)?;
            worker.ax_parts()?.0.focus(&handle)?;
            Ok(Response::Unit)
        })
    }
}

fn truncate(value: String) -> String {
    if value.chars().count() > ATTRIBUTE_MAX_CHARS {
        value
            .chars()
            .take(ATTRIBUTE_MAX_CHARS - 1)
            .chain(std::iter::once('\u{2026}'))
            .collect()
    } else {
        value
    }
}

mod click;
#[cfg(test)]
mod tests;
