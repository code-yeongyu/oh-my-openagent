//! Batch semantics: the steps run in order and the batch halts at the first failure; every
//! later step is reported with the provider's verbatim skip text and sends nothing; exactly
//! one final frame is appended whether the batch halted or not. A step is one of the single
//! calls the session has, so a batch can do nothing a single call cannot.

use omo_computer_core::backend::{FrameBytes, Refusal};
use omo_computer_core::params::{ClickParams, TypeTextParams};
use omo_computer_core::results::ExecReply;

use crate::{Refused, Session, NOT_OPEN};

#[derive(Debug, Clone, PartialEq)]
pub enum BatchStep {
    Click(Box<ClickParams>),
    TypeText(TypeTextParams),
}

#[derive(Debug, Clone, PartialEq)]
pub enum StepOutcome {
    Done(Box<ExecReply>),
    Failed(Refused),
    /// Not run: the provider's skip text, verbatim.
    Skipped { text: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct BatchOutcome {
    pub steps: Vec<StepOutcome>,
    /// The one appended frame of the whole batch.
    pub final_frame: Result<FrameBytes, Refusal>,
}

/// Runs `steps` in order, halting at the first failure (RED stub: runs nothing).
pub fn run(_session: &mut Session, _steps: Vec<BatchStep>, _skip_text: &str) -> BatchOutcome {
    BatchOutcome {
        steps: Vec::new(),
        final_frame: Err(NOT_OPEN),
    }
}

