//! A `--stdio` engine on the fake backend with a scenario the test writes itself, for the
//! crash-isolation and stop tests that need more than a recorded case: calls by id, and every
//! message read up to a given reply.

use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use tempfile::TempDir;

use super::case::repo;
use super::peer::Peer;

pub const TWO_DISPLAYS: &str = "crates/omo-computer-backend-fake/fixtures/two-displays-one-window.json";

pub struct Live {
    _runtime: TempDir,
    pub peer: Peer,
}

pub fn request(id: i64, method: &str, params: &Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

pub fn scenario_with(extra: &Value) -> Value {
    let text = fs::read_to_string(repo().join(TWO_DISPLAYS)).expect("the base scenario");
    let mut scenario: Value = serde_json::from_str(&text).expect("scenario JSON");
    for (key, value) in extra.as_object().expect("extra is an object") {
        scenario[key] = value.clone();
    }
    scenario
}

pub fn env(runtime: &Path, scenario: &Path) -> Vec<(String, String)> {
    vec![
        ("OMO_COMPUTER_BACKEND".to_owned(), "fake".to_owned()),
        ("OMO_COMPUTER_RUNTIME_DIR".to_owned(), runtime.to_string_lossy().into_owned()),
        ("OMO_COMPUTER_FAKE_SCENARIO".to_owned(), scenario.to_string_lossy().into_owned()),
        ("OMO_COMPUTER_FAKE_STOP_PATH".to_owned(), "live".to_owned()),
    ]
}

impl Live {
    pub fn spawn(args: &[&str], scenario: &Value) -> Self {
        let runtime = tempfile::tempdir().expect("a runtime dir");
        let file = runtime.path().join("scenario.json");
        fs::write(&file, scenario.to_string()).expect("the scenario file");
        let peer = Peer::spawn(args, &env(runtime.path(), &file), &repo());
        Self { _runtime: runtime, peer }
    }

    pub fn until_reply(&self, id: i64) -> Vec<Value> {
        let mut seen = Vec::new();
        loop {
            let message = self.peer.next().unwrap_or_else(|| panic!("no reply to {id} after {seen:?}"));
            let done = message["id"] == json!(id);
            seen.push(message);
            if done {
                return seen;
            }
        }
    }

    pub fn call(&mut self, id: i64, method: &str, params: &Value) -> Value {
        self.peer.send(&request(id, method, params));
        self.until_reply(id).pop().expect("until_reply ends at the reply")
    }
}
