//! `fake_scenario_fields_each_have_a_fixture_and_null_control`: every top-level key the loader
//! accepts is set by at least one fixture, and has a null control `v3-null-<key>.json` that is
//! one of those fixtures with exactly that key removed. The key list is read from the loader.

use std::path::Path;

use serde_json::{Map, Value};

use super::{field_names, fixtures_dir, FakeScenario};
use crate::FakeBackend;

fn fixtures() -> Vec<(String, Map<String, Value>)> {
    let mut all: Vec<(String, Map<String, Value>)> = std::fs::read_dir(fixtures_dir())
        .expect("the fixtures directory exists")
        .map(|entry| entry.expect("a readable fixture entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .map(|path| {
            let text = std::fs::read_to_string(&path).expect("a readable fixture");
            let name = Path::new(&path)
                .file_name()
                .expect("a file name")
                .to_string_lossy()
                .into_owned();
            match serde_json::from_str(&text).expect("fixture JSON") {
                Value::Object(map) => (name, map),
                other => panic!("{name} is not an object: {other}"),
            }
        })
        .collect();
    all.sort_by(|a, b| a.0.cmp(&b.0));
    all
}

#[test]
fn fake_scenario_fields_each_have_a_fixture_and_null_control() {
    let fields = field_names();
    assert!(fields.len() >= 39, "the loader lists its keys: {fields:?}");
    assert!(fields.iter().any(|f| f == "windows") && fields.iter().any(|f| f == "busy_timeline"));
    let fixtures = fixtures();
    for field in &fields {
        let setters: Vec<&(String, Map<String, Value>)> = fixtures
            .iter()
            .filter(|(_, map)| map.contains_key(field))
            .collect();
        assert!(!setters.is_empty(), "no fixture sets `{field}`");
        let control_name = format!("v3-null-{}.json", field.replace('_', "-"));
        let (_, control) = fixtures
            .iter()
            .find(|(name, _)| *name == control_name)
            .unwrap_or_else(|| panic!("`{field}` has no null control {control_name}"));
        assert!(
            !control.contains_key(field),
            "{control_name} still sets `{field}`"
        );
        let paired = setters.iter().any(|(_, setter)| {
            let mut without = (*setter).clone();
            without.remove(field);
            &without == control
        });
        assert!(
            paired,
            "{control_name} is not a fixture setting `{field}` minus that key"
        );
        for (name, map) in setters
            .iter()
            .copied()
            .chain(std::iter::once(&(control_name.clone(), control.clone())))
        {
            let scenario = FakeScenario::from_value(&Value::Object(map.clone()));
            assert!(scenario.is_ok(), "{name}: {scenario:?}");
        }
    }
    let unknown: Vec<&String> = fixtures
        .iter()
        .flat_map(|(_, map)| map.keys())
        .filter(|key| !fields.contains(key))
        .collect();
    assert!(
        unknown.is_empty(),
        "fixture keys the loader does not list: {unknown:?}"
    );
    assert!(
        FakeBackend::from_json("{}").is_ok(),
        "the empty scenario is the all-null control"
    );
}
