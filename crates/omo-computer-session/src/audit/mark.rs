//! The lines that hold a hand tampered (A-IS-62 R7-2): a chord refusal's line, as row 21's
//! `refuse_carried_chord` writes it (grant/host.rs), and the carried mark a rotation writes into
//! the file it retires and into the new file's `rotation_anchor` (R7-3).

use serde_json::Value;

use super::line::{AuditEvent, DeliveryKind, GateOutcome, Status, Tier};

const REFUSING_CALLS: [&str; 2] = ["session.open", "stopPath.start"];
/// The action of the line a rotation appends to the file it retires when a mark is unresolved.
pub const CARRIED_MARK: &str = "audit.carried_mark";
/// The evidence member an anchor carries when the file it opens follows an unresolved mark.
pub const CARRIES_MARK: &str = "carried_mark";

/// Whether `event` is a chord refusal's line (it is exempt from the hard cap and never cut).
#[must_use]
pub fn is_chord_refusal_event(event: &AuditEvent) -> bool {
    REFUSING_CALLS.contains(&event.action.as_str())
        && event.target == "stop_hotkey"
        && event.status == Status::Refused
        && event.gate.outcome == GateOutcome::Refused
        && event.gate.reason.as_deref() == Some("tampered")
}

/// Whether the stamped `line` holds the hand tampered: a chord refusal, a carried mark, or an
/// anchor that carries one.
#[must_use]
pub fn carries_mark(line: &Value) -> bool {
    let refusal = line["action"]
        .as_str()
        .is_some_and(|action| REFUSING_CALLS.contains(&action))
        && line["target"] == "stop_hotkey"
        && line["status"] == "refused"
        && line["gate"]["outcome"] == "refused"
        && line["gate"]["reason"] == "tampered";
    let carried = line["action"] == CARRIED_MARK;
    let anchored = is_anchor(line)
        && line["evidence"]
            .as_array()
            .is_some_and(|evidence| evidence.iter().any(|item| item == CARRIES_MARK));
    refusal || carried || anchored
}

/// Whether the stamped `line` is a `rotation_anchor`.
#[must_use]
pub fn is_anchor(line: &Value) -> bool {
    line["grant"]["verdict"] == "rotation_anchor"
}

/// The line a rotation appends as the last line of the file it retires when a mark is unresolved.
#[must_use]
pub fn carried_mark() -> AuditEvent {
    AuditEvent {
        action: CARRIED_MARK.to_owned(),
        target: "audit".to_owned(),
        delivery: DeliveryKind::Control,
        tier: Tier::Read,
        status: Status::Refused,
        evidence: vec![CARRIES_MARK.to_owned()],
        ..AuditEvent::default()
    }
}
