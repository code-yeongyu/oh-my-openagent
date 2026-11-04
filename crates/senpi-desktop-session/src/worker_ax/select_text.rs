//! `ax.selectText`: a text range selected inside one element's value, by
//! writing its selected range, so the value, the user's focus and the pointer
//! stay as they were and no key is sent. A following `ax.typeText` replaces
//! the selection.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_params::AxSelectTextParams;
use senpi_desktop_core::text_range::{SelectPart, TextSelectRequest};
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    pub(crate) fn ax_select_text(
        &mut self,
        params: &AxSelectTextParams,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation {
            text: Some(&params.text),
            ..Mutation::new(
                MutatingAction::AxSelectText,
                self.ref_target(&params.ref_),
                DeliveryMode::Background,
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            let request = TextSelectRequest {
                text: params.text.clone(),
                prefix: params.prefix.clone().unwrap_or_default(),
                suffix: params.suffix.clone().unwrap_or_default(),
                part: SelectPart::parse(params.select.as_deref())?,
            };
            let handle = worker.registry.resolve(&params.ref_)?;
            let selection = worker.ax_parts()?.0.select_text(&handle, &request)?;
            Ok(Response::TextSelection(selection))
        })
    }
}
