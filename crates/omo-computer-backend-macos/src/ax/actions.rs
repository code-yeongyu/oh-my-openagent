//! AX actions on refs and the value-verb ladder: `press` falls back AXPress -> AXConfirm ->
//! AXPick; `setValue` writes `AXValue` and reads it back; `selectText` writes the selected
//! range. Every act first re-checks the ref's window identity, so a ref from before a relaunch
//! answers `StaleRef{identity_changed}` with nothing sent.

use omo_computer_core::ax::{AxHandle, Slice, SLICE_MS};
use omo_computer_core::backend::{BackendResult, Delivered, Refusal, Semantic};
use omo_computer_core::error::{EngineCode, Reason};

use super::reader::MacAx;
use super::seam::{AxServer, AxStatus, AxValue, Element};

const ONE: Delivered = Delivered { count: 1, of: 1 };

fn ladder(semantic: &str) -> Option<&'static [&'static str]> {
    Some(match semantic {
        "press" => &["AXPress", "AXConfirm", "AXPick"],
        "confirm" => &["AXConfirm"],
        "cancel" => &["AXCancel"],
        "showMenu" => &["AXShowMenu"],
        "increment" => &["AXIncrement"],
        "decrement" => &["AXDecrement"],
        _ => return None,
    })
}

fn unsupported() -> Refusal {
    Refusal::new(EngineCode::AxUnsupported, Reason::PerformUnsupported)
}

fn status(status: AxStatus) -> BackendResult<Delivered> {
    match status {
        AxStatus::Done => Ok(ONE),
        AxStatus::Unsupported => Err(unsupported()),
        AxStatus::Gone => Err(Refusal::bare(EngineCode::StaleRef)),
        AxStatus::Failed => Err(Refusal::bare(EngineCode::AxFailed)),
    }
}

impl<S: AxServer> MacAx<S> {
    /// The live element behind `handle`, after the identity check.
    fn acting(&mut self, handle: AxHandle) -> BackendResult<Element> {
        let retained = self
            .handles
            .get(handle)
            .cloned()
            .ok_or(Refusal::bare(EngineCode::StaleRef))?;
        let now = self
            .server
            .window_owner(retained.window)
            .map(|o| (o.pid, o.process_start));
        if now != Some((retained.pid, retained.process_start)) {
            return Err(Refusal::new(EngineCode::StaleRef, Reason::IdentityChanged));
        }
        Ok(retained.element)
    }

    /// A semantic action on a ref.
    ///
    /// # Errors
    /// `StaleRef` for a dead or re-identified ref, `AxUnsupported{perform_unsupported}` when no
    /// rung of the ladder is supported, `AxFailed` when the app refused.
    pub fn perform(&mut self, handle: AxHandle, action: &Semantic) -> BackendResult<Delivered> {
        let element = self.acting(handle)?;
        if action.0 == "focus" {
            return status(self.server.set(element, "AXFocused", AxValue::Bool(true)));
        }
        let rungs = ladder(&action.0).ok_or_else(unsupported)?;
        for rung in rungs {
            match self.server.perform(element, rung) {
                AxStatus::Unsupported => {}
                other => return status(other),
            }
        }
        Err(unsupported())
    }

    /// `setValue`: writes `AXValue` and confirms it by reading it back.
    ///
    /// # Errors
    /// As [`Self::perform`]; `AxUnconfirmed` when the read-back differs.
    pub fn set_value(&mut self, handle: AxHandle, text: &str) -> BackendResult<Delivered> {
        let element = self.acting(handle)?;
        status(
            self.server
                .set(element, "AXValue", AxValue::Text(text.to_owned())),
        )?;
        match self.server.read(element, SLICE_MS) {
            Slice::Read(Some(read)) if read.value.as_deref() == Some(text) => Ok(ONE),
            _ => Err(Refusal::bare(EngineCode::AxUnconfirmed)),
        }
    }

    /// `selectText`: writes `AXSelectedTextRange`.
    ///
    /// # Errors
    /// As [`Self::perform`].
    pub fn select_text(
        &mut self,
        handle: AxHandle,
        location: u32,
        length: u32,
    ) -> BackendResult<Delivered> {
        let element = self.acting(handle)?;
        status(self.server.set(
            element,
            "AXSelectedTextRange",
            AxValue::Range { location, length },
        ))
    }
}
