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
