//! The two typed argument refusals of row 23 (R48a, `design/d-sdk-skill.md` '### Error
//! codes' invalid arguments shape (3)): `InvalidArguments` with its reason, the field and a
//! message naming the instancePath and the limit; nothing is sent and there is no next call.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use serde_json::json;

use crate::mutate::Refused;

fn invalid(reason: Reason, field: &str, limit: &str) -> Refused {
    let mut refused = Refused::from(Refusal::new(EngineCode::Internal, reason.wire()));
    refused.detail = Some(Box::new(json!({
        "field": field,
        "message": format!("/{field}: expected {limit}"),
    })));
    refused
}

/// A hold duration outside `0..=100 s`.
pub(crate) fn hold_duration() -> Refused {
    invalid(Reason::HoldDuration, "duration", "0..=100 s")
}

/// A scroll asking for more than `MAX_SCROLL_STEPS` clicks (R48b: the field is `clicks`).
pub(crate) fn scroll_steps(field: &str) -> Refused {
    invalid(Reason::ScrollSteps, field, "0..=1000")
}
