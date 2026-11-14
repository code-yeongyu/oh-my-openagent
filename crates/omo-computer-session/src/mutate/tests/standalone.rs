//! The v3-r17 replacements of the three marker cases replay standalone: each runs in a fresh
//! runtime root holding only the state the case plants (`runtime.plant`), the way the replay
//! driver runs it, so no case depends on what an earlier run left behind. A case a later row
//! superseded replays through its newest replacement.

use std::fs;
use std::path::{Path, PathBuf};

use omo_computer_backend_fake::{
    FakeBackend, FakeClock, FakeScenario, RecordingSink, StopPathScript,
};
use omo_computer_core::paths::Roots;
use omo_computer_core::results::ExecReply;
use serde_json::{json, Value};

use super::params;
use crate::{Refused, Session};

const CASES: [&str; 3] = [
    "v3-r17-marker-written-before-input.json",
    "v3-r17-marker-crash-redrive-uncertain.json",
    "v3-r17-marker-unavailable.json",
];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn conformance() -> PathBuf {
    repo().join("crates/omo-computer-core/fixtures/conformance")
}

/// The newest case of `name`'s supersedes chain: the case that names it in `supersedes`, followed
/// to the end (a later row's replacement replays in its place).
fn newest(name: &str) -> String {
    let superseder = fs::read_dir(conformance())
        .expect("the conformance dir")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .find(|path| {
            fs::read_to_string(path)
                .ok()
                .and_then(|text| serde_json::from_str::<Value>(&text).ok())
                .is_some_and(|case| {
                    case["supersedes"]
                        .as_array()
                        .is_some_and(|names| names.contains(&json!(name)))
                })
        });
    superseder.map_or_else(
        || name.to_owned(),
        |path| newest(&path.file_name().expect("a file name").to_string_lossy()),
    )
}

fn mode(item: &Value) -> Option<u32> {
    item["mode"]
        .as_str()
        .and_then(|mode| u32::from_str_radix(mode, 8).ok())
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).expect("mode set");
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) {}

/// The directories a case narrowed, put back to 0700 when dropped (a panicking replay
/// included), so the tempdir can always be removed.
struct Restore(Vec<PathBuf>);

impl Drop for Restore {
    fn drop(&mut self) {
        for dir in &self.0 {
            set_mode(dir, 0o700);
        }
    }
}

#[cfg(unix)]
#[test]
fn restore_resets_narrowed_modes_when_the_replay_panics() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().expect("tempdir");
    let dir = root.path().join("markers");
    fs::create_dir(&dir).expect("dir");
    set_mode(&dir, 0o500);
    let replayed = std::panic::catch_unwind(|| {
        let _restore = Restore(vec![dir.clone()]);
        panic!("a replay step failed");
    });
    assert!(replayed.is_err(), "the replay panicked");
    let mode = fs::metadata(&dir).expect("dir").permissions().mode();
    assert_eq!(mode & 0o777, 0o700, "the narrowed mode is restored");
}

/// Whether the tests run as root, which ignores a read-only directory mode.
#[cfg(unix)]
fn is_root() -> bool {
    crate::marker::euid() == 0
}

#[cfg(not(unix))]
const fn is_root() -> bool {
    false
}

/// Plants the case's `runtime.plant` under `root`, directory modes last; answers the
/// directories whose mode was narrowed.
fn plant(root: &Path, case: &Value, as_root: bool) -> Vec<PathBuf> {
    let items = case["runtime"]["plant"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for item in &items {
        let target = root.join(item["path"].as_str().expect("a plant path"));
        if item["dir"] == json!(true) {
            fs::create_dir_all(&target).expect("planted dir");
            continue;
        }
        fs::create_dir_all(target.parent().expect("a parent")).expect("parent dir");
        fs::write(&target, item["content"].as_str().expect("plant content")).expect("planted file");
        set_mode(&target, mode(item).unwrap_or(0o600));
    }
    items
        .iter()
        .filter(|item| item["dir"] == json!(true))
        .filter_map(|item| {
            let narrowed = mode(item)?;
            let target = root.join(item["path"].as_str()?);
            // Root ignores a mode without owner write: a plain file at the dir's path refuses
            // every write under it, root included, so the case's refusal holds as root too.
            if as_root && narrowed & 0o200 == 0 {
                fs::remove_dir_all(&target).expect("planted dir removed");
                fs::write(&target, b"read-only as root: a file where the dir goes")
                    .expect("a file in its place");
                return None;
            }
            set_mode(&target, narrowed);
            Some(target)
        })
        .collect()
}

/// One engine process of the case over `roots`.
fn engine(case: &Value, roots: &Roots) -> Session {
    let scenario = repo().join(case["scenario"].as_str().expect("a scenario"));
    let scenario = FakeScenario::load(&scenario).expect("scenario loads");
    let stop = if case["env"]["OMO_COMPUTER_FAKE_STOP_PATH"] == json!("live") {
        StopPathScript::Live
    } else {
        StopPathScript::None
    };
    let backend = FakeBackend::with_parts(scenario, FakeClock::default(), RecordingSink::default())
        .with_stop_path(stop);
    Session::for_roots(Box::new(backend), roots)
}

fn check(outcome: Result<ExecReply, Refused>, expected: &Value, at: &str) {
    match outcome {
        Ok(reply) => assert_eq!(
            Some(&serde_json::to_value(reply).expect("reply JSON")),
            expected.get("result"),
            "{at}"
        ),
        Err(refused) => {
            let data = &expected["error"]["data"];
            assert_eq!(json!(refused.refusal.code.wire()), data["code"], "{at}");
            assert_eq!(
                json!(refused.refusal.reason),
                data.get("reason").cloned().unwrap_or(Value::Null),
                "{at}"
            );
            if let Some(call_id) = data.get("callId") {
                assert_eq!(&json!(refused.call_id), call_id, "{at}");
            }
            assert_eq!(
                refused
                    .interrupted
                    .map(|d| serde_json::to_value(d).expect("disposition JSON")),
                data.get("disposition").cloned(),
                "{at}"
            );
        }
    }
}

/// Replays the case's steps in process, a restart being a new engine over the same roots.
fn replay(name: &str, case: &Value, root: &Path) {
    let roots = Roots {
        state: root.to_owned(),
        runtime: root.to_owned(),
    };
    let mut session = engine(case, &roots);
    for (index, step) in case["steps"].as_array().expect("steps").iter().enumerate() {
        if step["restart"] == json!(true) {
            session = engine(case, &roots);
            continue;
        }
        let at = format!("{name} step {}", index + 1);
        let send = &step["send"];
        let expected = &step["expect"][0]["message"];
        match send["method"].as_str().expect("a method") {
            "session.open" => {
                session.open(params(send["params"].clone())).expect(&at);
            }
            "stopPath.start" => {
                session.stop_path_start(params(send["params"].clone()));
            }
            "capture" => {
                session.capture(params(send["params"].clone())).expect(&at);
            }
            "click" => check(session.click(params(send["params"].clone())), expected, &at),
            other => panic!("{at}: this replay does not drive {other}"),
        }
    }
}

#[test]
fn v3_r17_marker_cases_replay_standalone_in_a_fresh_runtime_root() {
    for name in CASES {
        assert!(conformance().join(name).exists(), "{name} is missing");
        let replayed = newest(name);
        let path = conformance().join(&replayed);
        let case: Value = serde_json::from_str(&fs::read_to_string(&path).expect("case text"))
            .expect("case JSON");
        assert_eq!(
            case["env"].get("OMO_COMPUTER_RUNTIME_DIR"),
            None,
            "{name} names no fixed runtime dir"
        );
        let root = tempfile::tempdir().expect("tempdir");
        let _restore = Restore(plant(root.path(), &case, is_root()));
        replay(&replayed, &case, root.path());
        if name == "v3-r17-marker-written-before-input.json" {
            let marker = fs::read_to_string(root.path().join("markers/local/default.json"))
                .expect("the marker");
            assert!(
                marker.contains("\"callId\":\"qa-marker-happy\""),
                "{marker}"
            );
        }
    }
}

/// Root ignores a 0500 mode, so as root the read-only `markers` dir that
/// `v3-r17-marker-unavailable.json` (replayed through its newest replacement) plants is laid
/// down as a plain file at that path, which refuses the marker write for root too (same
/// `marker_unavailable`, nothing sent). Forced here so the root path is exercised on every
/// runner, root or not.
#[test]
fn the_marker_unavailable_case_still_refuses_when_planted_as_root() {
    let name = newest("v3-r17-marker-unavailable.json");
    let path = conformance().join(&name);
    let case: Value =
        serde_json::from_str(&fs::read_to_string(&path).expect("case text")).expect("case JSON");
    let root = tempfile::tempdir().expect("tempdir");
    let _restore = Restore(plant(root.path(), &case, true));
    assert!(
        root.path().join("markers").is_file(),
        "as root the read-only markers dir is planted as a plain file"
    );
    replay(&name, &case, root.path());
}
