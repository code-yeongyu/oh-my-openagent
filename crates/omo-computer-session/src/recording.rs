//! Row 27: opt-in session recording (acceptance 99; design row K13). `computer.record` defaults to
//! `false`; when on, `start` opens `cursor.jsonl` under the artifact dir and writes the
//! `recording.start` audit line, every `sample` appends one row at most every 16 ms and none while
//! the engine's own sampled secure state is on (the gap is the pause), and `stop` writes
//! `recording.stop`. The video half runs only through a backend encoder; with none it reads
//! inactive with reason `no_encoder` while `cursor.jsonl` is still written. Neither file is ever
//! returned to the model.

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

use omo_computer_core::recording::{Cadence, CursorRow, RecordingEncoder, NO_ENCODER};

use crate::audit::{AuditEvent, AuditSink, DeliveryKind, Status, Tier};

/// The file name of the cursor track inside the artifact dir.
pub const CURSOR_FILE: &str = "cursor.jsonl";

/// What the video half is doing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Video {
    Active,
    Inactive { reason: &'static str },
}

/// A running recording.
pub struct Recorder {
    cursor: BufWriter<File>,
    cursor_path: PathBuf,
    cadence: Cadence,
    encoder: Option<Box<dyn RecordingEncoder>>,
    rows: u64,
}

fn line(action: &str) -> AuditEvent {
    AuditEvent {
        action: action.to_owned(),
        target: "recording".to_owned(),
        delivery: DeliveryKind::Control,
        tier: Tier::Read,
        status: Status::Success,
        ..AuditEvent::default()
    }
}

impl Recorder {
    /// Starts recording into `dir` when `record` is on; `None` when it is off.
    ///
    /// # Errors
    /// The cursor file could not be created, or the start line could not be audited.
    pub fn start(
        record: bool,
        dir: &Path,
        encoder: Option<Box<dyn RecordingEncoder>>,
        audit: &mut dyn AuditSink,
    ) -> io::Result<Option<Self>> {
        if !record {
            return Ok(None);
        }
        let cursor_path = dir.join(CURSOR_FILE);
        let cursor = BufWriter::new(File::create(&cursor_path)?);
        audit.append(line("recording.start"))?;
        Ok(Some(Self {
            cursor,
            cursor_path,
            cadence: Cadence::default(),
            encoder,
            rows: 0,
        }))
    }

    #[must_use]
    pub fn video(&self) -> Video {
        if self.encoder.is_some() {
            Video::Active
        } else {
            Video::Inactive { reason: NO_ENCODER }
        }
    }

    /// Takes one cursor sample; skipped faster than 60 Hz and while `secure`.
    ///
    /// # Errors
    /// The row could not be written.
    pub fn sample(&mut self, row: &CursorRow, secure: bool) -> io::Result<bool> {
        if !self.cadence.admit(row.t, secure) {
            return Ok(false);
        }
        serde_json::to_writer(&mut self.cursor, row)?;
        self.cursor.write_all(b"\n")?;
        self.rows += 1;
        Ok(true)
    }

    /// Stops: flushes the cursor track, finishes any video and writes `recording.stop`.
    ///
    /// # Errors
    /// The cursor track could not be flushed or the stop line could not be audited.
    pub fn stop(mut self, audit: &mut dyn AuditSink) -> io::Result<u64> {
        self.cursor.flush()?;
        if let Some(encoder) = self.encoder.as_mut() {
            let _ = encoder.finish();
        }
        audit.append(line("recording.stop"))?;
        Ok(self.rows)
    }

    #[must_use]
    pub fn cursor_path(&self) -> &Path {
        &self.cursor_path
    }
}

#[cfg(test)]
mod tests;
