//! Generates `schema/engine.schema.json` from the method table. The file is never edited
//! by hand: `protocol_test::schema_is_fresh` fails until it is regenerated with
//! `OMO_COMPUTER_UPDATE_SCHEMA=1 cargo test -p omo-computer-core`.

use std::collections::BTreeMap;

use schemars::generate::SchemaSettings;
use serde_json::{json, Map, Value};

use crate::env::ENV_SEAMS;
use crate::hello::{ABI, PROTOCOL_VERSION};
use crate::methods::{method_schemas, notification_schemas, ONESHOT_ALIASES, ONESHOT_PREFIX};
use crate::settings::{Settings, SETTINGS_TABLE};

/// The schema file, relative to the crate root.
pub const SCHEMA_PATH: &str = "schema/engine.schema.json";

/// The engine protocol schema as a JSON value.
#[must_use]
pub fn engine_schema() -> Value {
    let mut generator = SchemaSettings::draft2020_12().into_generator();
    let mut methods = Map::new();
    for (spec, params, result) in method_schemas(&mut generator) {
        let row = json!({
            "effect": spec.effect,
            "exposure": spec.exposure.label(),
            "params": params,
            "result": result,
        });
        methods.insert(spec.name.to_owned(), row);
    }
    let mut notifications = Map::new();
    for (name, params) in notification_schemas(&mut generator) {
        notifications.insert(name.to_owned(), json!({ "params": params }));
    }
    let settings = generator.subschema_for::<Settings>();
    let definitions: BTreeMap<String, Value> =
        generator.take_definitions(true).into_iter().collect();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "omo-computer engine protocol",
        "protocolVersion": PROTOCOL_VERSION,
        "abi": ABI,
        "oneshot": {
            "prefix": ONESHOT_PREFIX,
            "aliases": ONESHOT_ALIASES.iter().map(|(alias, method)| ((*alias).to_owned(), json!(method))).collect::<Map<_, _>>(),
        },
        "methods": methods,
        "notifications": notifications,
        "settings": settings,
        "settingsTable": SETTINGS_TABLE,
        "envSeams": ENV_SEAMS,
        "$defs": definitions,
    })
}

/// The schema file's exact text: pretty JSON with a trailing newline.
#[must_use]
pub fn engine_schema_text() -> String {
    let mut text = serde_json::to_string_pretty(&engine_schema()).unwrap_or_default();
    text.push('\n');
    text
}
