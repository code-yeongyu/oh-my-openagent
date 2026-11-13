//! Replays one corpus case against this crate's engine binary the way a consumer drives it:
//! a fresh runtime dir per case (`OMO_COMPUTER_RUNTIME_DIR`, `${RUNTIME_DIR}` substituted in env
//! values), the planted starting state, one process per case (per request for `--oneshot`), and
//! the fake sink counted where a step names it.

use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::case::{load, repo, Case, Plant, Step, Transport};
use super::compare::{self, compare, Context, Delta};
use super::peer::Peer;

const SINK_PREFIX: &str = "fake-sink-";
const RUNTIME_PLACEHOLDER: &str = "${RUNTIME_DIR}";
const TOKEN_PLACEHOLDER: &str = "${RESUME_TOKEN}";

pub struct Report {
    pub name: String,
    pub failures: Vec<String>,
    pub deltas: Vec<Delta>,
}

impl Report {
    pub fn assert_clean(&self) {
        for delta in &self.deltas {
            println!("DELTA matched={} {}", delta.matched, delta.line);
        }
        assert!(self.failures.is_empty(), "{} did not replay clean:\n{}", self.name, self.failures.join("\n"));
    }
}

fn plant_in(runtime: &Path, items: &[Plant]) {
    for item in items {
        let target = runtime.join(&item.path);
        match &item.content {
            None => fs::create_dir_all(&target).expect("a planted dir"),
            Some(content) => {
                fs::create_dir_all(target.parent().expect("a planted file has a parent")).expect("planted parents");
                fs::write(&target, content).expect("a planted file");
                set_mode(&target, item.mode.unwrap_or(0o600));
            }
        }
    }
    for item in items.iter().filter(|item| item.content.is_none()) {
        if let Some(mode) = item.mode {
            set_mode(&runtime.join(&item.path), mode);
        }
    }
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("the planted mode applies");
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) {}

fn sink_count(runtime: &Path) -> usize {
    fs::read_dir(runtime)
        .expect("the runtime dir is readable")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(SINK_PREFIX))
        .map(|entry| fs::read_to_string(entry.path()).unwrap_or_default())
        .map(|text| text.lines().filter(|line| !line.trim().is_empty()).count())
        .sum()
}

fn env_for(case: &Case, runtime: &Path) -> Vec<(String, String)> {
    let runtime_text = runtime.to_string_lossy().into_owned();
    let mut env = vec![
        ("OMO_COMPUTER_BACKEND".to_owned(), "fake".to_owned()),
        ("OMO_COMPUTER_RUNTIME_DIR".to_owned(), runtime_text.clone()),
    ];
    if let Some(scenario) = &case.scenario {
        env.push(("OMO_COMPUTER_FAKE_SCENARIO".to_owned(), repo().join(scenario).to_string_lossy().into_owned()));
    }
    env.extend(case.env.iter().map(|(name, value)| (name.clone(), value.replace(RUNTIME_PLACEHOLDER, &runtime_text))));
    env
}

pub fn replay_case(case: &Case) -> Report {
    let runtime = tempfile::tempdir().expect("a runtime dir");
    if let Some(block) = &case.host {
        super::host::setup(runtime.path(), block);
    }
    replay_case_in(case, runtime.path())
}

pub fn replay_case_in(case: &Case, runtime: &Path) -> Report {
    plant_in(runtime, &case.plant);
    let env = env_for(case, runtime);
    let spawn = || Peer::spawn(case.transport.args(), &env, &repo());
    let mut deltas = compare::load(&case.name);
    let mut failures = Vec::new();
    let persistent = case.transport != Transport::Oneshot;
    let mut token: Option<String> = None;
    let mut peer = persistent.then(spawn);
    for (index, step) in case.steps.iter().enumerate() {
        let Step::Send { send, expect, sink } = step else {
            if let Some(old) = peer.take() {
                failures.extend(old.close().into_iter().map(|m| format!("LEFTOVER {m}")));
            }
            peer = persistent.then(spawn);
            continue;
        };
        let mut oneshot = None;
        let target = match peer.as_mut() {
            Some(peer) => peer,
            None => oneshot.insert(spawn()),
        };
        let send = match &token {
            Some(token) => serde_json::from_str(&send.to_string().replace(TOKEN_PLACEHOLDER, token)).expect("a substituted send"),
            None => send.clone(),
        };
        target.send(&send);
        for (j, expectation) in expect.iter().enumerate() {
            let label = format!("step={} message={}", index + 1, j + 1);
            let Some(message) = target.next() else {
                failures.push(format!("MISMATCH {label}: no message within the per-message wait"));
                break;
            };
            let mut ctx = Context {
                variable: expectation.variable.iter().map(String::as_str).collect(),
                deltas: &mut deltas,
                failures: Vec::new(),
            };
            if let Some(seen) = message["result"]["resumeToken"].as_str() {
                token = Some(seen.to_owned());
            }
            compare(&expectation.message, Some(&message), "", &mut ctx);
            failures.extend(ctx.failures.into_iter().map(|f| format!("MISMATCH {label} {f}")));
        }
        if let Some(done) = oneshot {
            failures.extend(done.close().into_iter().map(|m| format!("LEFTOVER {m}")));
        }
        if let Some(want) = sink {
            let found = sink_count(runtime);
            if found != *want {
                failures.push(format!("MISMATCH step={} sink: expected {want} entries, found {found}", index + 1));
            }
        }
    }
    if let Some(peer) = peer {
        failures.extend(peer.close().into_iter().map(|m| format!("LEFTOVER {m}")));
    }
    Report { name: case.name.clone(), failures, deltas }
}

pub fn replay(name: &str) -> Report {
    replay_case(&load(name))
}
