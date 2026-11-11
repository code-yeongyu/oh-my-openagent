//! Acceptance 2 and design rows C1 / C17: every params member and every settings key has
//! a reader, and no reader names a member the schema does not have.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::readers::PARAM_READERS;
use crate::schema::engine_schema;
use crate::settings::{GROUPED_KEYS, SETTINGS_TABLE};

fn definition_name(reference: &str) -> Option<&str> {
    reference.strip_prefix("#/$defs/")
}

fn references(value: &Value, found: &mut BTreeSet<String>) {
    match value {
        Value::Object(object) => {
            if let Some(name) = object
                .get("$ref")
                .and_then(Value::as_str)
                .and_then(definition_name)
            {
                found.insert(name.to_owned());
            }
            object.values().for_each(|inner| references(inner, found));
        }
        Value::Array(items) => items.iter().for_each(|inner| references(inner, found)),
        _ => {}
    }
}

fn members(definition: &Value) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let alternatives = ["anyOf", "oneOf"]
        .iter()
        .flat_map(|key| definition[*key].as_array().cloned().unwrap_or_default());
    for object in std::iter::once(definition.clone()).chain(alternatives) {
        for name in object["properties"]
            .as_object()
            .map(|properties| properties.keys().cloned().collect::<Vec<_>>())
            .unwrap_or_default()
        {
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

/// `(definition, member)` pairs reachable from every method's params, the settings tree aside.
fn param_members(schema: &Value) -> BTreeSet<(String, String)> {
    let mut pending = BTreeSet::new();
    for row in schema["methods"].as_object().expect("methods").values() {
        references(&row["params"], &mut pending);
    }
    let mut visited = BTreeSet::new();
    while let Some(name) = pending.pop_first() {
        if name == "Settings" || !visited.insert(name.clone()) {
            continue;
        }
        references(&schema["$defs"][&name], &mut pending);
    }
    visited
        .iter()
        .flat_map(|name| {
            members(&schema["$defs"][name])
                .into_iter()
                .map(move |member| (name.clone(), member))
        })
        .collect()
}

fn declared_readers() -> BTreeSet<(String, String)> {
    PARAM_READERS
        .iter()
        .flat_map(|table| table.iter())
        .flat_map(|(definition, _, fields)| {
            fields
                .iter()
                .map(move |field| ((*definition).to_owned(), (*field).to_owned()))
        })
        .collect()
}

fn settings_keys(schema: &Value) -> BTreeSet<String> {
    let settings = &schema["$defs"]["Settings"]["properties"];
    let mut keys = BTreeSet::new();
    for (key, property) in settings.as_object().expect("settings properties") {
        if GROUPED_KEYS.contains(&key.as_str()) {
            let mut group = BTreeSet::new();
            references(property, &mut group);
            for name in group {
                keys.extend(
                    members(&schema["$defs"][&name])
                        .into_iter()
                        .map(|member| format!("{key}.{member}")),
                );
            }
        } else {
            keys.insert(key.clone());
        }
    }
    keys
}

fn unread_params(schema: &Value) -> (usize, Vec<String>) {
    let members = param_members(schema);
    let readers = declared_readers();
    let mut problems: Vec<String> = members
        .difference(&readers)
        .map(|(definition, member)| format!("unread: {definition}.{member}"))
        .collect();
    problems.extend(
        readers.difference(&members).map(|(definition, member)| {
            format!("reader of a missing member: {definition}.{member}")
        }),
    );
    (members.len(), problems)
}

#[test]
fn schema_fields_have_readers() {
    let (count, problems) = unread_params(&engine_schema());
    println!("params members: {count}, unread: {}", problems.len());
    assert!(count > 200, "the params walk found only {count} members");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn reader_test_reports_zero_unread_fields() {
    let schema = engine_schema();
    let (params, mut problems) = unread_params(&schema);
    let keys = settings_keys(&schema);
    let rows: BTreeSet<String> = SETTINGS_TABLE
        .iter()
        .map(|row| row.key.to_owned())
        .collect();
    problems.extend(
        keys.difference(&rows)
            .map(|key| format!("unread setting: computer.{key}")),
    );
    problems.extend(
        rows.difference(&keys)
            .map(|key| format!("table row without a schema key: computer.{key}")),
    );
    problems.extend(
        SETTINGS_TABLE
            .iter()
            .filter(|row| row.reader.trim().is_empty())
            .map(|row| format!("no reader: computer.{}", row.key)),
    );
    for round_four in [
        "url_policy",
        "run_limits",
        "record",
        "pause_ceiling_ms",
        "display_awake_grace_ms",
        "display_awake_session_cap_ms",
        "x11_keymap_remap",
    ] {
        assert!(
            keys.contains(round_four),
            "the round-4 row {round_four} is enumerated"
        );
    }
    println!(
        "unread fields: {} (params members {params}, settings keys {})",
        problems.len(),
        keys.len()
    );
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
