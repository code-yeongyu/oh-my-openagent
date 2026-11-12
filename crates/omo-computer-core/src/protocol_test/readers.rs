//! Acceptance 2 and design rows C1 / C17: the reader test enumerates the schema's params
//! members against reader CALL SITES. The read set is derived from the reader functions in
//! `src/requests` (see `read_sites`), never from a list: a member is read only when a reader
//! destructures its type, names the field and moves the value into its output.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::crate_path;
use super::read_sites::{reader_sites, sites_by_member, Site};
use crate::requests::READER_SOURCES;
use crate::schema::engine_schema;
use crate::settings::{GROUPED_KEYS, SETTINGS_TABLE};

/// The types whose serde names are their Rust field names (the `computer.*` keys).
const SNAKE_CASE_TYPES: &[&str] = &["Settings", "McpSettings"];

fn references(value: &Value, found: &mut BTreeSet<String>) {
    match value {
        Value::Object(object) => {
            if let Some(name) = object
                .get("$ref")
                .and_then(Value::as_str)
                .and_then(|reference| reference.strip_prefix("#/$defs/"))
            {
                found.insert(name.to_owned());
            }
            object.values().for_each(|inner| references(inner, found));
        }
        Value::Array(items) => items.iter().for_each(|inner| references(inner, found)),
        _ => {}
    }
}

fn members(definition: &Value) -> BTreeSet<String> {
    let alternatives = ["anyOf", "oneOf"]
        .iter()
        .flat_map(|key| definition[*key].as_array().cloned().unwrap_or_default());
    std::iter::once(definition.clone())
        .chain(alternatives)
        .flat_map(|object| {
            object["properties"]
                .as_object()
                .map(|properties| properties.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        })
        .collect()
}

/// The serde name of a Rust field: `reference` is `ref`; params are camelCase; the settings
/// table keeps its snake_case keys.
fn wire_name(ty: &str, field: &str) -> String {
    if field == "reference" {
        return "ref".to_owned();
    }
    if SNAKE_CASE_TYPES.contains(&ty) {
        return field.to_owned();
    }
    let mut name = String::new();
    let mut upper = false;
    for character in field.chars() {
        if character == '_' {
            upper = true;
        } else if upper {
            name.extend(character.to_uppercase());
            upper = false;
        } else {
            name.push(character);
        }
    }
    name
}

/// Every definition reachable from the methods' params with its members. Under `Settings`
/// the unit is the table row: its keys, and the members of the grouped keys.
fn param_definitions(schema: &Value) -> BTreeMap<String, BTreeSet<String>> {
    let mut pending = BTreeSet::new();
    for row in schema["methods"].as_object().expect("methods").values() {
        references(&row["params"], &mut pending);
    }
    let mut found = BTreeMap::new();
    while let Some(name) = pending.pop_first() {
        if found.contains_key(&name) {
            continue;
        }
        let definition = &schema["$defs"][&name];
        if name == "Settings" {
            for key in GROUPED_KEYS {
                references(&definition["properties"][*key], &mut pending);
            }
        } else {
            references(definition, &mut pending);
        }
        let names = members(definition);
        if !names.is_empty() {
            found.insert(name, names);
        }
    }
    found
}

fn describe(sites: &[Site]) -> String {
    sites
        .iter()
        .map(|site| {
            format!(
                "{}::{} ({}): {}",
                site.file, site.function, site.field, site.why_unread
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// `(members checked, problems)`: every schema member must have a reading site, and every
/// reading site must name a schema member.
fn unread_members(schema: &Value) -> (usize, Vec<String>) {
    let definitions = param_definitions(schema);
    let sites = reader_sites(&crate_path(READER_SOURCES));
    let by_member = sites_by_member(&sites, wire_name);
    let mut problems = Vec::new();
    let mut checked = 0;
    for (definition, wire_members) in &definitions {
        let read_sites = by_member.get(definition).cloned().unwrap_or_default();
        for member in wire_members {
            checked += 1;
            let at = read_sites.get(member).cloned().unwrap_or_default();
            // Every site that destructures the type must read the member: a second reader of the
            // same type that drops it (`force: _`) fails even when another reader reads it.
            let dropped: Vec<Site> = at.iter().filter(|site| !site.read).cloned().collect();
            if at.is_empty() || !dropped.is_empty() {
                let reason = if at.is_empty() {
                    "no reader names it".to_owned()
                } else {
                    describe(&dropped)
                };
                problems.push(format!("unread: {definition}.{member} - {reason}"));
            }
        }
        for (member, at) in &read_sites {
            let positional = member.chars().all(|character| character.is_ascii_digit());
            if positional && !at.iter().all(|site| site.read) {
                problems.push(format!(
                    "unread: {definition} variant value {member} - {}",
                    describe(at)
                ));
            } else if !positional && !wire_members.contains(member) {
                problems.push(format!(
                    "reader of a member the schema does not have: {definition}.{member} ({})",
                    describe(at)
                ));
            }
        }
    }
    (checked, problems)
}

#[test]
fn schema_fields_have_readers() {
    let (checked, problems) = unread_members(&engine_schema());
    println!("members checked: {checked}, unread: {}", problems.len());
    for problem in &problems {
        println!("{problem}");
    }
    assert!(
        checked > 250,
        "the params walk found only {checked} members"
    );
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

#[test]
fn reader_test_reports_zero_unread_fields() {
    let schema = engine_schema();
    let (checked, mut problems) = unread_members(&schema);
    let settings = &schema["$defs"]["Settings"]["properties"];
    let mut keys = BTreeSet::new();
    for (key, property) in settings.as_object().expect("settings properties") {
        if GROUPED_KEYS.contains(&key.as_str()) {
            let mut group = BTreeSet::new();
            references(property, &mut group);
            keys.extend(
                group
                    .iter()
                    .flat_map(|name| members(&schema["$defs"][name]))
                    .map(|member| format!("{key}.{member}")),
            );
        } else {
            keys.insert(key.clone());
        }
    }
    let rows: BTreeSet<String> = SETTINGS_TABLE
        .iter()
        .map(|row| row.key.to_owned())
        .collect();
    problems.extend(
        keys.difference(&rows)
            .map(|key| format!("settings key without a table row: computer.{key}")),
    );
    problems.extend(
        rows.difference(&keys)
            .map(|key| format!("table row without a schema key: computer.{key}")),
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
        "unread fields: {} (members checked {checked}, settings keys {})",
        problems.len(),
        keys.len()
    );
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
