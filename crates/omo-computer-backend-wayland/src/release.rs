//! What the release-on-close proof admits (RED skeleton).

use omo_computer_core::backend::Refusal;

/// How a verb uses input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbKind {
    Hold,
    HoldingInput,
    AxAction,
    Read,
}

impl VerbKind {
    #[must_use]
    pub fn from_wire(kind: &str) -> Option<Self> {
        match kind {
            "hold" => Some(Self::Hold),
            "holding_input" => Some(Self::HoldingInput),
            "ax_action" => Some(Self::AxAction),
            "read" => Some(Self::Read),
            _ => None,
        }
    }
}

/// # Errors
/// Never in the skeleton.
pub const fn admit(_verb: VerbKind) -> Result<(), Refusal> {
    Ok(())
}
