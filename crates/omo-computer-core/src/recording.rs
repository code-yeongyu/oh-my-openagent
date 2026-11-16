//! Opt-in session recording (acceptance 99; design row K13): `computer.record` defaults to
//! `false`. When on, the engine writes `cursor.jsonl` rows `{t, x, y, action, windowId}` at 60 Hz
//! and, through an OS encoder, a best-effort `recording.mp4`, both under the artifact dir. The
//! recorder PAUSES on the engine's own sampled secure state (never on a model-issued `observe`),
//! leaving a gap. Neither file is ever model-bound. With no encoder (R34) `cursor.jsonl` is still
//! written and the video side reads inactive with reason `no_encoder`.

use serde::Serialize;

use crate::backend::{FrameBytes, Refusal};

/// The sample interval of `cursor.jsonl`: 60 Hz, rounded down to whole milliseconds.
pub const SAMPLE_INTERVAL_MS: u64 = 16;
/// The reason the video half reports when the backend has no encoder.
pub const NO_ENCODER: &str = "no_encoder";

/// One `cursor.jsonl` row.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorRow {
    pub t: u64,
    pub x: f64,
    pub y: f64,
    /// ASD-18's action vocabulary: `move`, `click`, `drag`, `scroll`, `type`, `key`.
    pub action: &'static str,
    pub window_id: Option<String>,
}

/// An OS encoder the per-OS rows plug in (R34); the default backend has none.
pub trait RecordingEncoder: Send {
    /// # Errors
    /// The encoder's refusal; the recording continues without that frame.
    fn push(&mut self, at_ms: u64, frame: &FrameBytes) -> Result<(), Refusal>;

    /// Closes the file and reports its size in bytes.
    ///
    /// # Errors
    /// The encoder could not finish the file.
    fn finish(&mut self) -> Result<u64, Refusal>;
}

/// Whether the recorder takes a sample at `now_ms`: never while secure, at most every
/// [`SAMPLE_INTERVAL_MS`].
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Cadence {
    last_ms: Option<u64>,
}

impl Cadence {
    pub fn admit(&mut self, now_ms: u64, secure: bool) -> bool {
        if secure || self.last_ms.is_some_and(|last| now_ms.saturating_sub(last) < SAMPLE_INTERVAL_MS) {
            return false;
        }
        self.last_ms = Some(now_ms);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_rows_carry_the_five_fields() {
        let row = CursorRow { t: 5, x: 1.0, y: 2.0, action: "click", window_id: Some("101".to_owned()) };
        assert_eq!(
            serde_json::to_value(&row).expect("row"),
            serde_json::json!({ "t": 5, "x": 1.0, "y": 2.0, "action": "click", "windowId": "101" })
        );
    }

    #[test]
    fn the_cadence_is_60_hz_and_pauses_while_secure() {
        let mut cadence = Cadence::default();
        assert!(cadence.admit(0, false));
        assert!(!cadence.admit(15, false), "faster than 60 Hz");
        assert!(cadence.admit(16, false));
        assert!(!cadence.admit(40, true), "paused while secure");
        assert!(cadence.admit(41, false), "resumes after the secure interval");
    }
}
