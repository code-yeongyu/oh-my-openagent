//! `clipboard.read` and `clipboard.write`. Reading is a read-only request;
//! writing is a mutating one, so it passes the gate and is audited by the
//! text's length and digest, never its contents.

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_params::ClipboardText;
use senpi_desktop_core::types::Target;
use senpi_desktop_safety::MutatingAction;

use crate::mutate::Mutation;
use crate::request::Response;
use crate::worker::{Audited, Worker};

impl Worker {
    pub(crate) fn clipboard_read(&mut self) -> CoreResult<Response> {
        let text = self.backend()?.clipboard_read()?;
        Ok(Response::Clipboard(ClipboardText { text }))
    }

    /// The clipboard is not a window: the audit target is `desktop`, and no
    /// focus or cursor is captured or restored around the write.
    pub(crate) fn clipboard_write(
        &mut self,
        params: &ClipboardText,
        cancelled: &dyn Fn() -> bool,
    ) -> CoreResult<Audited> {
        let mutation = Mutation {
            text: Some(&params.text),
            ..Mutation::new(
                MutatingAction::ClipboardWrite,
                Target::Desktop.key().to_owned(),
                DeliveryMode::Background,
            )
        };
        self.mutate(&mutation, cancelled, |worker| {
            worker.backend()?.clipboard_write(&params.text)?;
            let written = u32::try_from(params.text.chars().count()).unwrap_or(u32::MAX);
            mutation.text_delivered.set(written);
            Ok(Response::Unit)
        })
    }
}

#[cfg(test)]
mod tests;
