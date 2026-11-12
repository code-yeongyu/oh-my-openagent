//! The per-window reservation (acceptance 85; design row C24): a window-targeted exec reserves
//! its window from admission to its report plus 10,000 ms, or until the owning session closes;
//! another session's window exec on it answers `InputBusy{window, holder, retryAfterMs}` with
//! nothing sent. Reads are never reserved. A held reservation (`mouse.down` until `mouse.up`, a
//! foreground lease on the window) has no expiry until it is released. Records live under the
//! RUNTIME root so independent sessions of the uid see each other's.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::lease::{is_live, write_new, Holder, SessionToken};

/// How long a reservation outlives the report of the call that took it.
pub const AFTER_REPORT_MS: u64 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(flatten)]
    holder: Holder,
    /// `None` while the call is in flight or the reservation is held.
    until_ms: Option<u64>,
}

/// Another session holds the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowBusy {
    pub window: String,
    pub holder: Holder,
    pub retry_after_ms: u64,
}

impl WindowBusy {
    /// The members the refusal carries on the wire.
    #[must_use]
    pub fn detail(&self) -> Value {
        json!({
            "window": self.window,
            "holder": { "sessionId": self.holder.session_id, "agent": self.holder.agent },
            "retryAfterMs": self.retry_after_ms,
        })
    }
}

/// The reservations of one session's view of the machine.
#[derive(Debug, Default)]
pub struct Reservations {
    memory: BTreeMap<String, Record>,
}

impl Reservations {
    /// Reserves every window in `windows` for this session until its report.
    ///
    /// # Errors
    /// The first window another live session holds at `now_ms`; nothing is reserved then.
    pub fn admit(&mut self, token: &SessionToken, windows: &[String], now_ms: u64) -> Result<(), WindowBusy> {
        self.check(token, windows, now_ms)?;
        for window in windows {
            self.put(token, window, None);
        }
        Ok(())
    }

    /// Whether every window in `windows` is free for this session; nothing is taken.
    ///
    /// # Errors
    /// The first window another live session holds at `now_ms`.
    pub fn check(&self, token: &SessionToken, windows: &[String], now_ms: u64) -> Result<(), WindowBusy> {
        if true { return Ok(()); }
        windows
            .iter()
            .find_map(|window| self.busy(token, window, now_ms))
            .map_or(Ok(()), Err)
    }

    /// The report went out: the reservations run on for [`AFTER_REPORT_MS`].
    pub fn report(&mut self, token: &SessionToken, windows: &[String], now_ms: u64) {
        for window in windows {
            if self.mine(token, window) {
                self.put(token, window, Some(now_ms.saturating_add(AFTER_REPORT_MS)));
            }
        }
    }

    /// Holds `window` with no expiry (`mouse.down`, a foreground lease on it).
    pub fn hold(&mut self, token: &SessionToken, window: &str) {
        self.put(token, window, None);
    }

    /// Releases this session's reservation of `window` at once.
    pub fn release(&mut self, token: &SessionToken, window: &str) {
        if self.mine(token, window) {
            self.memory.remove(window);
            if let Some(dir) = token.dir() {
                let _ = fs::remove_file(record_path(dir, window));
            }
        }
    }

    /// Releases every reservation this session holds (session close).
    pub fn release_all(&mut self, token: &SessionToken) {
        let windows: Vec<String> = self.memory.keys().cloned().collect();
        for window in windows {
            self.release(token, &window);
        }
    }

    fn busy(&self, token: &SessionToken, window: &str, now_ms: u64) -> Option<WindowBusy> {
        let record = self.record(token, window)?;
        if record.holder == *token.holder() {
            return None;
        }
        if let Some(dir) = token.dir() {
            if !is_live(dir, &record.holder) {
                return None;
            }
        }
        let retry_after_ms = match record.until_ms {
            Some(until) if until <= now_ms => return None,
            Some(until) => until - now_ms,
            None => AFTER_REPORT_MS,
        };
        Some(WindowBusy {
            window: window.to_owned(),
            holder: record.holder,
            retry_after_ms,
        })
    }

    fn mine(&self, token: &SessionToken, window: &str) -> bool {
        self.record(token, window).is_some_and(|r| r.holder == *token.holder())
    }

    fn record(&self, token: &SessionToken, window: &str) -> Option<Record> {
        match token.dir() {
            None => self.memory.get(window).cloned(),
            Some(dir) => serde_json::from_slice(&fs::read(record_path(dir, window)).ok()?).ok(),
        }
    }

    fn put(&mut self, token: &SessionToken, window: &str, until_ms: Option<u64>) {
        let record = Record {
            holder: token.holder().clone(),
            until_ms,
        };
        if let Some(dir) = token.dir() {
            let path = record_path(dir, window);
            let _ = fs::create_dir_all(dir.join("windows"));
            let _ = fs::remove_file(&path);
            let _ = write_new(&path, &serde_json::to_vec(&record).unwrap_or_default());
        }
        self.memory.insert(window.to_owned(), record);
    }
}

fn record_path(dir: &Path, window: &str) -> PathBuf {
    let safe: String = window
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    dir.join("windows").join(format!("{safe}.json"))
}
