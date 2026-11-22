//! Batch semantics: the steps run in order and the batch halts at the first failure; every
//! later step is reported with the provider's verbatim skip text and sends nothing; exactly
//! one final frame is appended whether the batch halted or not. A step is one of the single
//! calls the session has, so a batch can do nothing a single call cannot.

use omo_computer_core::backend::{CaptureOptions, FrameBytes, Refusal, Target};
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
    Skipped {
        text: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct BatchOutcome {
    pub steps: Vec<StepOutcome>,
    /// The one appended frame of the whole batch.
    pub final_frame: Result<FrameBytes, Refusal>,
}

/// Runs `steps` in order, halting at the first failure.
pub fn run(session: &mut Session, steps: Vec<BatchStep>, skip_text: &str) -> BatchOutcome {
    let mut outcomes = Vec::with_capacity(steps.len());
    let mut halted = false;
    for step in steps {
        if halted {
            outcomes.push(StepOutcome::Skipped {
                text: skip_text.to_owned(),
            });
            continue;
        }
        let result = match step {
            BatchStep::Click(params) => session.click(*params),
            BatchStep::TypeText(params) => session.type_text(params),
        };
        outcomes.push(match result {
            Ok(reply) => StepOutcome::Done(Box::new(reply)),
            Err(refused) => {
                halted = true;
                StepOutcome::Failed(refused)
            }
        });
    }
    BatchOutcome {
        steps: outcomes,
        final_frame: session.final_frame(),
    }
}

impl Session {
    /// The batch's final frame: one capture of the desktop, the pointer drawn.
    fn final_frame(&mut self) -> Result<FrameBytes, Refusal> {
        self.opened.as_ref().ok_or(NOT_OPEN)?;
        let options = CaptureOptions {
            cursor: true,
            crosshair: None,
            region: None,
        };
        self.backend.capture(&Target::Desktop, &options)
    }
}
