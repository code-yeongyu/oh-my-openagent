//! Replays the conformance corpus (`senpi-desktop-core/fixtures/conformance`)
//! against the built engine binary. Each step's messages must deep-equal the
//! expected ones modulo the declared `variable` JSON pointers (present, any
//! value). Within one step the order of messages is free: a reply and the
//! notifications it caused are written by different threads. A message left
//! over after the last step fails the case.
//!
//! `SENPI_DESKTOP_CONFORMANCE_DIR` replays another corpus directory; the TS
//! twin (`packages/desktop-engine/test/conformance.test.ts`) reports the same
//! `<case>: steps/<i>/expect/<j>` locator for the same mismatch.

mod common;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use common::{fake_backend, Engine};
use serde::Deserialize;
use serde_json::Value;

const REPO_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
const CORPUS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-core/fixtures/conformance"
);

#[derive(Deserialize)]
struct Case {
    scenario: String,
    #[serde(default)]
    env: BTreeMap<String, String>,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
struct Step {
    send: Value,
    expect: Vec<Expected>,
}

#[derive(Deserialize)]
struct Expected {
    message: Value,
    #[serde(default)]
    variable: Vec<String>,
}

/// `message` with every `variable` member nulled; `None` when one is absent.
fn masked(message: &Value, variable: &[String]) -> Option<Value> {
    let mut masked = message.clone();
    for pointer in variable {
        *masked.pointer_mut(pointer)? = Value::Null;
    }
    Some(masked)
}

fn matches(expected: &Expected, actual: &Value) -> bool {
    masked(actual, &expected.variable)
        .is_some_and(|actual| masked(&expected.message, &expected.variable) == Some(actual))
}

fn replay(name: &str, case: &Case) -> Result<(), String> {
    let scenario = Path::new(REPO_ROOT).join(&case.scenario);
    if !scenario.is_file() {
        return Err(format!("{name}: scenario {} does not exist", case.scenario));
    }
    let mut env = vec![fake_backend(scenario.to_str().expect("repo paths are UTF-8"))];
    env.extend(case.env.iter().map(|(key, value)| (key.as_str(), value.clone())));
    let mut engine = Engine::spawn(&env);
    for (index, step) in case.steps.iter().enumerate() {
        engine.send(&step.send);
        let mut actual: Vec<Value> = step.expect.iter().map(|_| engine.next()).collect();
        for (slot, expected) in step.expect.iter().enumerate() {
            let Some(found) = actual.iter().position(|message| matches(expected, message)) else {
                return Err(format!(
                    "{name}: steps/{index}/expect/{slot}: no message matched {}; got {actual:?}",
                    expected.message
                ));
            };
            actual.swap_remove(found);
        }
    }
    let trailing = engine.drain();
    if trailing.is_empty() {
        return Ok(());
    }
    Err(format!("{name}: unexpected trailing messages {trailing:?}"))
}

fn corpus() -> Vec<(String, Case)> {
    let dir = std::env::var_os("SENPI_DESKTOP_CONFORMANCE_DIR")
        .map_or_else(|| PathBuf::from(CORPUS), PathBuf::from);
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|error| panic!("corpus {} is readable: {error}", dir.display()))
        .map(|entry| entry.expect("corpus entry is readable").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .collect();
    paths.sort();
    paths
        .into_iter()
        .map(|path| {
            let name = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or_default()
                .to_owned();
            let text = std::fs::read_to_string(&path).expect("fixture is readable");
            let case = serde_json::from_str(&text).unwrap_or_else(|error| panic!("{name}: {error}"));
            (name, case)
        })
        .collect()
}

#[test]
fn every_conformance_case_replays_against_the_engine_binary() {
    // Given
    let corpus = corpus();
    assert!(!corpus.is_empty(), "the conformance corpus is empty");
    // When
    let failures: Vec<String> = corpus
        .iter()
        .filter_map(|(name, case)| replay(name, case).err())
        .collect();
    // Then
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
