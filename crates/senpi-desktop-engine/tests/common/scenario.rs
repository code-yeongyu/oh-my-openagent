//! Per-test fake-backend scenarios and the host's stop-path activation.

use std::path::PathBuf;

use serde_json::{json, Value};

use super::{fake_backend, Engine, TWO_DISPLAYS};

pub const CHORD: &str = "ctrl+alt+shift+escape";

/// The two-display scenario with some top-level keys replaced, written to a
/// file unique to this run and removed on drop.
pub struct Scenario {
    path: PathBuf,
}

impl Scenario {
    /// `overlay` is an object whose keys (`capabilities`, `delay_ms`,
    /// `fail_next`, `resize_window`, ...) replace the base scenario's.
    pub fn two_displays_with(overlay: &Value) -> Self {
        let base = std::fs::read_to_string(TWO_DISPLAYS).expect("base scenario is readable");
        let mut scenario: Value = serde_json::from_str(&base).expect("base scenario is JSON");
        let overlay = overlay.as_object().expect("an overlay is a JSON object");
        for (key, value) in overlay {
            scenario[key] = value.clone();
        }
        let path = std::env::temp_dir().join(format!(
            "senpi-desktop-engine-scenario-{}-{}.json",
            std::process::id(),
            ulid::Ulid::generate()
        ));
        std::fs::write(&path, scenario.to_string()).expect("scenario is written");
        Self { path }
    }

    /// The `SENPI_DESKTOP_BACKEND` pair selecting this scenario.
    pub fn backend(&self) -> (&'static str, String) {
        fake_backend(self.path.to_str().expect("temp paths are UTF-8"))
    }
}

impl Drop for Scenario {
    fn drop(&mut self) {
        // A leftover file in the temp dir is harmless; the next run uses a new name.
        let _ = std::fs::remove_file(&self.path);
    }
}

/// An engine over `backend` under the fake clock, plus `env`.
pub fn headless(backend: (&'static str, String), env: &[(&'static str, &str)]) -> Engine {
    let mut vars = vec![backend, ("SENPI_DESKTOP_FAKE_CLOCK", "1".to_owned())];
    vars.extend(env.iter().map(|(name, value)| (*name, (*value).to_owned())));
    Engine::spawn(&vars)
}

/// What the host does after activation (todo 12): open under
/// `allowHostRelayOnlyStop`, arm the relay, beat once. Returns the resume token.
pub fn make_stop_path_live(engine: &mut Engine) -> String {
    let opened = engine.invoke("session.open", json!({"allowHostRelayOnlyStop": true}));
    let started = engine.invoke("stopPath.start", json!({"chord": CHORD}));
    assert_eq!(started["result"]["hostRelayLive"], json!(true), "{started}");
    engine.invoke("stopPath.heartbeat", json!({}));
    opened["result"]["resumeToken"]
        .as_str()
        .expect("session.open returns a resume token")
        .to_owned()
}

/// Snapshots window `target` and returns the ref of the first line containing
/// `label`.
pub fn snapshot_ref(engine: &mut Engine, target: &str, label: &str) -> String {
    let snapshot = engine.invoke("ax.snapshot", json!({"target": target}));
    snapshot["result"]["text"]
        .as_str()
        .and_then(|text| text.lines().find(|line| line.contains(label)))
        .and_then(|line| line.split("[ref=").nth(1))
        .and_then(|rest| rest.split(']').next())
        .unwrap_or_else(|| panic!("no ref for {label} in {snapshot}"))
        .to_owned()
}

/// Captures `target` and returns the frame id.
pub fn capture(engine: &mut Engine, target: &str) -> String {
    let captured = engine.invoke("capture", json!({"target": target, "caps": {"maxWidth": 320}}));
    captured["result"]["frameId"]
        .as_str()
        .unwrap_or_else(|| panic!("capture of {target} failed: {captured}"))
        .to_owned()
}
