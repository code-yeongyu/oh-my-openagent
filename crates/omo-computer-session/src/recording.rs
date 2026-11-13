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
mod tests {
    use omo_computer_core::recording::CursorRow;

    use crate::audit::MemoryAudit;

    use super::{Recorder, Video, CURSOR_FILE};

    fn row(t: u64) -> CursorRow {
        CursorRow { t, x: 10.0, y: 20.0, action: "move", window_id: Some("101".to_owned()) }
    }

    fn actions(audit: &MemoryAudit) -> Vec<String> {
        audit.lines().iter().filter_map(|line| line["action"].as_str().map(str::to_owned)).collect()
    }

    #[test]
    fn recording_is_off_by_default_and_writes_nothing() {
        let dir = tempfile::tempdir().expect("dir");
        let mut audit = MemoryAudit::new("hand", 0);
        let recorder = Recorder::start(false, dir.path(), None, &mut audit).expect("start");
        assert!(recorder.is_none());
        assert!(!dir.path().join(CURSOR_FILE).exists());
        assert!(actions(&audit).is_empty());
    }

    #[test]
    fn recording_writes_cursor_rows_at_60_hz_and_pauses_while_secure() {
        let dir = tempfile::tempdir().expect("dir");
        let mut audit = MemoryAudit::new("hand", 0);
        let mut recorder = Recorder::start(true, dir.path(), None, &mut audit).expect("start").expect("on");
        let taken: Vec<bool> = [(0, false), (8, false), (16, false), (32, true), (48, true), (64, false)]
            .into_iter()
            .map(|(t, secure)| recorder.sample(&row(t), secure).expect("sample"))
            .collect();
        assert_eq!(taken, [true, false, true, false, false, true], "60 Hz; nothing while secure");
        assert_eq!(recorder.stop(&mut audit).expect("stop"), 3);

        let written = std::fs::read_to_string(dir.path().join(CURSOR_FILE)).expect("cursor.jsonl");
        let times: Vec<u64> = written
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(line).expect("row")["t"].as_u64().expect("t"))
            .collect();
        assert_eq!(times, [0, 16, 64], "the secure interval is a gap");
        assert_eq!(actions(&audit), ["recording.start", "recording.stop"], "one audit pair");
    }

    #[test]
    fn without_an_encoder_the_video_is_inactive_with_no_encoder() {
        let dir = tempfile::tempdir().expect("dir");
        let mut audit = MemoryAudit::new("hand", 0);
        let recorder = Recorder::start(true, dir.path(), None, &mut audit).expect("start").expect("on");
        assert_eq!(recorder.video(), Video::Inactive { reason: "no_encoder" });
        assert!(recorder.cursor_path().ends_with(CURSOR_FILE), "the cursor track is still written");
    }
}
