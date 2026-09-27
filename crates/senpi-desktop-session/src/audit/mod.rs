//! The `audit` record of one mutating request. Typed text is never audited:
//! only its length and the first 16 hex digits of its SHA-256. When
//! `session.open` supplies `auditPath`, each record is also appended as one
//! JSON line; screenshot artifacts are GC'd from `artifactDir`.

mod gc;
mod writer;

use std::fmt::Write as _;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{DesktopError, ErrorCode};
use senpi_desktop_core::methods::Method;
use senpi_desktop_core::protocol_results::AuditEvent;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::mutate::Mutation;
use crate::worker::Worker;

pub(crate) use gc::ArtifactGc;

/// Hex digits of the text digest kept in the audit.
const TEXT_SHA256_HEX_DIGITS: usize = 16;

pub(crate) fn audit_event(
    mutation: &Mutation<'_>,
    code: Option<ErrorCode>,
    focus_restored: Option<bool>,
    elapsed: Duration,
) -> AuditEvent {
    AuditEvent {
        action: mutation.action.method(),
        target: mutation.target.clone(),
        delivery: match mutation.delivery {
            DeliveryMode::Background => "background",
            DeliveryMode::Foreground => "foreground",
        }
        .to_owned(),
        frame_id: mutation.frame_id.map(str::to_owned),
        code,
        duration_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        focus_restored,
        text_length: mutation
            .text
            .map(|text| u32::try_from(text.chars().count()).unwrap_or(u32::MAX)),
        text_sha256: mutation.text.map(text_sha256_prefix),
        keys: mutation.keys.map(<[String]>::to_vec),
    }
}

fn text_sha256_prefix(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut hex = String::with_capacity(TEXT_SHA256_HEX_DIGITS);
    for byte in digest.iter().take(TEXT_SHA256_HEX_DIGITS / 2) {
        // Writing to a `String` cannot fail.
        write!(hex, "{byte:02x}").unwrap_or(());
    }
    hex
}

/// One JSONL line. A superset of the `audit` notification: the extra fields
/// are for the on-disk log (AD-7). Typed text is never a field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditRecord {
    pub timestamp: String,
    pub session_id: String,
    pub run_id: String,
    pub action: Method,
    pub target: String,
    pub delivery: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<ErrorCode>,
    pub status: AuditStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_error: Option<DesktopError>,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus_restored: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_length: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AuditStatus {
    Success,
    Error,
    Suspended,
}

impl AuditRecord {
    fn new(worker: &Worker, event: &AuditEvent, error: Option<&DesktopError>) -> Self {
        let status = match event.code {
            None => AuditStatus::Success,
            Some(ErrorCode::Suspended) => AuditStatus::Suspended,
            Some(_) => AuditStatus::Error,
        };
        Self {
            timestamp: rfc3339_ms(unix_now_ms()),
            session_id: worker.session_id.clone(),
            run_id: worker.run_id.clone(),
            action: event.action,
            target: event.target.clone(),
            delivery: event.delivery.clone(),
            frame_id: event.frame_id.clone(),
            code: event.code,
            status,
            primary_error: error.cloned(),
            duration_ms: event.duration_ms,
            focus_restored: event.focus_restored,
            screenshot_path: None,
            screenshot_width: None,
            screenshot_height: None,
            text_length: event.text_length,
            text_sha256: event.text_sha256.clone(),
            keys: event.keys.clone(),
            message: error.map(|error| error.message.clone()),
        }
    }
}

impl Worker {
    /// Appends one JSONL line when `auditPath` is set. Failures go to stderr
    /// and never fail the action. The same [`AuditEvent`] was already sent to
    /// [`crate::mutate::SessionSafety::audit`].
    pub(crate) fn persist_audit(&self, event: &AuditEvent, error: Option<&DesktopError>) {
        let Some(path) = self
            .options
            .as_ref()
            .and_then(|options| options.audit_path.as_deref())
        else {
            return;
        };
        writer::append(path, &AuditRecord::new(self, event, error));
    }

    /// Sweeps `artifactDir` when the scan interval has elapsed.
    pub(crate) fn maybe_gc(&mut self) {
        let Some(knobs) = self.options.as_ref().map(|options| options.screenshot_gc) else {
            return;
        };
        let dir = self.artifact_dir();
        self.gc.maybe_run(&dir, unix_now_ms(), knobs);
    }
}

pub(crate) fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// UTC timestamp with millisecond precision, no extra crate.
pub(crate) fn rfc3339_ms(unix_ms: u64) -> String {
    let millis = unix_ms % 1000;
    let secs = unix_ms / 1000;
    let days = secs / 86_400;
    let tod = secs % 86_400;
    let (year, month, day) = civil_ymd(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z",
        hour = tod / 3600,
        min = (tod % 3600) / 60,
        sec = tod % 60,
    )
}

/// Howard Hinnant's `civil_from_days` for Unix day counts.
fn civil_ymd(unix_days: u64) -> (i32, u8, u8) {
    let z = i64::try_from(unix_days)
        .unwrap_or(i64::MAX)
        .saturating_add(719_468);
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (
        i32::try_from(year).unwrap_or(i32::MAX),
        u8::try_from(month).unwrap_or(u8::MAX),
        u8::try_from(day).unwrap_or(u8::MAX),
    )
}

pub(crate) fn warn(message: impl std::fmt::Display) {
    let text = format!("senpi-desktop-session: {message}");
    eprintln!("{text}");
    #[cfg(test)]
    WARNINGS.with(|warnings| warnings.borrow_mut().push(text));
}

#[cfg(test)]
thread_local! {
    static WARNINGS: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(all(test, unix))]
pub(crate) fn take_warnings() -> Vec<String> {
    WARNINGS.with(|warnings| std::mem::take(&mut *warnings.borrow_mut()))
}

#[cfg(test)]
mod timestamp_tests {
    use super::rfc3339_ms;

    #[test]
    fn audit_timestamp_rfc3339_matches_civil_unix() {
        assert_eq!(rfc3339_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(rfc3339_ms(1_000), "1970-01-01T00:00:01.000Z");
        assert_eq!(rfc3339_ms(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
        assert_eq!(rfc3339_ms(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
    }
}
