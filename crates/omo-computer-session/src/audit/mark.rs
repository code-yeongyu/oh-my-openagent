//! The lines that leave the hand tampered (A-IS-62 R7-2): a chord refusal's line, as row 21's
//! `refuse_carried_chord` writes it (grant/host.rs:297-327).

use serde_json::Value;

const REFUSING_CALLS: [&str; 2] = ["session.open", "stopPath.start"];

#[must_use]
pub fn is_chord_refusal(line: &Value) -> bool {
    line["action"]
        .as_str()
        .is_some_and(|action| REFUSING_CALLS.contains(&action))
        && line["target"] == "stop_hotkey"
        && line["status"] == "refused"
        && line["gate"]["outcome"] == "refused"
        && line["gate"]["reason"] == "tampered"
}
