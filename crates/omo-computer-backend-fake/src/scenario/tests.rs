use std::path::{Path, PathBuf};

use omo_computer_core::backend::Backend;

use super::{fixtures_dir, FakeScenario, InvalidKind};
use crate::{FakeBackend, Persona};

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The fixture files, imported (no `v3-` prefix) or added by the v3 rows.
fn fixture_files(imported: bool) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(fixtures_dir())
        .expect("the fixtures directory exists")
        .map(|entry| entry.expect("a readable fixture entry").path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .filter(|path| file_name(path).starts_with("v3-") != imported)
        .collect();
    paths.sort();
    paths
}

#[test]
fn scenario_fixtures_all_parse() {
    let imported = fixture_files(true);
    assert_eq!(
        imported.len(),
        12,
        "the imported scenario set is exactly 12 files"
    );
    for path in &imported {
        let scenario = FakeScenario::load(path);
        assert!(scenario.is_ok(), "{}: {scenario:?}", file_name(path));
        println!("fixture {} ok", file_name(path));
    }
    for path in imported.iter().chain(fixture_files(false).iter()) {
        let scenario = FakeScenario::load(path).expect("every fixture loads");
        for persona in Persona::ALL {
            let backend = FakeBackend::new(scenario.clone()).with_persona(persona);
            let capabilities = backend.capabilities();
            assert_eq!(capabilities.backend, "fake", "{}", file_name(path));
            assert_eq!(
                usize::try_from(capabilities.display_count).ok(),
                Some(scenario.displays.len()),
                "{} as {persona:?}",
                file_name(path)
            );
        }
    }
}

#[test]
fn unknown_scenario_key_is_scenario_invalid() {
    let unknown = r#"{"windowz":[]}"#;
    let invalid = FakeScenario::from_json(unknown).expect_err("an unknown key never loads");
    assert_eq!(invalid.kind, InvalidKind::UnknownKey);
    assert_eq!(invalid.pointer, "/windowz");
    assert!(
        FakeBackend::from_json(unknown).is_err(),
        "no backend is built"
    );

    let nested = r#"{"windows":[{"id":"1","title":"t","app":"a","pid":1,"x":0,"y":0,"width":10,"height":10,"focused":true,"elevated":null,"titel":"x"}]}"#;
    let invalid = FakeScenario::from_json(nested).expect_err("a nested unknown key never loads");
    assert_eq!(invalid.pointer, "/windows/0/titel");

    let escaped = FakeScenario::from_json(r#"{"a/b~c":1}"#).expect_err("an escaped unknown key");
    assert_eq!(escaped.pointer, "/a~1b~0c");

    let malformed = FakeScenario::from_json("{\"windows\":").expect_err("malformed JSON");
    assert_eq!(malformed.kind, InvalidKind::Syntax);

    let dangling = r#"{"identity":{"999":{"processStart":1}}}"#;
    let reference = FakeScenario::from_json(dangling).expect_err("a window nobody lists");
    assert_eq!(reference.kind, InvalidKind::Reference);
    assert_eq!(reference.pointer, "/identity/999");
}
