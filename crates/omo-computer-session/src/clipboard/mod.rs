//! Row 24's clipboard (design row C10): `clipboard.read` (read tier) and `clipboard.write`
//! (exec tier) refuse under a secure focus or Secure Input with nothing read or written; a
//! concealed clipboard is never read. Clipboard contents never enter the audit.

use omo_computer_core::clipboard::ClipboardRead;
use omo_computer_core::results::{ClipboardContent, ConcealedReason};
use omo_computer_core::untrusted::UntrustedText;

use crate::mutate::Refused;
use crate::Session;

/// What a secure-focus probe's answer means for the clipboard (R60a): a secure field, or an
/// unknown answer, refuses (`design/d-macos.md`:109).
#[must_use]
pub(crate) const fn clipboard_refused(secure: Option<bool>) -> bool {
    !matches!(secure, Some(false))
}

impl Session {
    /// Before any clipboard read or write: a secure field with focus (or an unknown answer),
    /// or Secure Input on, answers the refused report with nothing sent.
    pub(crate) fn clipboard_gate(&self, method: omo_computer_core::methods::Method) -> Result<Option<omo_computer_core::report::ActionReport>, Refused> {
        let secure_input = matches!(self.backend.capabilities().session.secure_input_active, omo_computer_core::session_state::Tristate::Known(true));
        if clipboard_refused(self.backend.secure_focus(None)) || secure_input {
            return crate::mutate::refused_reply(method, omo_computer_core::report::RefusalReason::SecureFocus).map(Some);
        }
        Ok(None)
    }

    /// `clipboard.read`.
    ///
    /// # Errors
    /// `Internal{secure_focus}` under a secure focus, or the backend's refusal.
    pub fn clipboard_read(&mut self) -> Result<serde_json::Value, Refused> {
        if let Some(refused) = self.clipboard_gate(omo_computer_core::methods::Method::ClipboardRead)? {
            return Ok(serde_json::json!(refused));
        }
        Ok(serde_json::json!(match self.backend.clipboard_read().map_err(Refused::from)? {
            ClipboardRead::Text(text) => ClipboardContent {
                text: Some(text),
                formats: vec!["text".to_owned()],
                secure: None,
                reason: None,
                observation: UntrustedText,
            },
            ClipboardRead::Concealed => ClipboardContent {
                text: Some(None),
                formats: Vec::new(),
                secure: Some(true),
                reason: Some(ConcealedReason::Concealed),
                observation: UntrustedText,
            },
        }))
    }

    /// `clipboard.write` (exec tier).
    ///
    /// # Errors
    /// `Internal{secure_focus}` under a secure focus, or the funnel's refusal.
    pub fn clipboard_write(&mut self, params: omo_computer_core::params::ClipboardWriteParams) -> Result<omo_computer_core::results::ExecReply, Refused> {
        if let Some(refused) = self.clipboard_gate(omo_computer_core::methods::Method::ClipboardWrite)? {
            return Ok(omo_computer_core::results::ExecReply(Some(refused)));
        }
        let authority = omo_computer_core::requests::CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let call = omo_computer_safety::Call { verb: omo_computer_safety::VerbKind::Keyboard, target: omo_computer_safety::TargetRef::read(None), points: Vec::new(), chord: None, force: false };
        let write = crate::value_verbs::Write::Clipboard { text: params.text };
        self.mutate(crate::mutate::Mutation::exec(omo_computer_core::methods::Method::ClipboardWrite, call, Vec::new(), omo_computer_core::backend::Route::BackgroundWindow, &authority).with_write(write))
    }

    /// `paste`: the prior clipboard is read only to be restored (a concealed one is not read).
    ///
    /// # Errors
    /// `Internal{secure_focus}` under a secure focus, or the funnel's refusal.
    pub fn paste(&mut self, params: omo_computer_core::params::PasteParams) -> Result<omo_computer_core::results::ExecReply, Refused> {
        if let Some(refused) = self.clipboard_gate(omo_computer_core::methods::Method::Paste)? {
            return Ok(omo_computer_core::results::ExecReply(Some(refused)));
        }
        let prior = self.backend.clipboard_read().map_err(Refused::from)?;
        let restore = omo_computer_core::clipboard::Restore::of(prior);
        let authority = omo_computer_core::requests::CallAuthority { call_id: params.call_id.clone(), run_generation: params.run_generation };
        let call = omo_computer_safety::Call { verb: omo_computer_safety::VerbKind::Keyboard, target: omo_computer_safety::TargetRef::read(Some(&params.target)), points: Vec::new(), chord: None, force: params.force.unwrap_or(false) };
        let chord = if cfg!(target_os = "macos") { "cmd+v" } else { "ctrl+v" };
        let write = crate::value_verbs::Write::Paste { text: params.text, chord: chord.to_owned(), restore };
        self.mutate(crate::mutate::Mutation::exec(omo_computer_core::methods::Method::Paste, call, Vec::new(), omo_computer_core::backend::Route::ForegroundHid, &authority).with_write(write))
    }
}

#[cfg(test)]
mod tests;
