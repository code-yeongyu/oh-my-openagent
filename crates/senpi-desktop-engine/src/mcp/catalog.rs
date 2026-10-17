//! The MCP tool catalog, generated from the engine schema: the same public
//! methods `--oneshot` forwards, plus `desktop.stop` and `desktop.stopPath.status`.
//! `desktop.stopPath.heartbeat` is listed only when the user started the
//! facade with `--allow-host-relay-only-stop`, the one case where the host
//! relay is the stop path and its heartbeat must reach the engine.

use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Map, Value};

use crate::oneshot::METHOD_PREFIX;

const HEARTBEAT: &str = "stopPath.heartbeat";

pub struct Catalog {
    tools: Vec<Value>,
    methods: HashMap<String, String>,
}

impl Catalog {
    pub fn new(schema: &Value, allow_host_relay_only_stop: bool) -> Self {
        let definitions = schema["definitions"].as_object().cloned().unwrap_or_default();
        let mut entries: BTreeMap<String, (String, Value)> = BTreeMap::new();
        for (name, spec) in schema["methods"].as_object().into_iter().flatten() {
            let host_only = spec["hostOnly"].as_bool().unwrap_or(true);
            let test_only = spec["testOnly"].as_bool().unwrap_or(true);
            let heartbeat = name == HEARTBEAT && allow_host_relay_only_stop;
            if (host_only || test_only) && name != "stopPath.status" && !heartbeat {
                continue;
            }
            let description = format!(
                "senpi-desktop-engine `{name}` ({})",
                spec["effect"].as_str().unwrap_or("read")
            );
            entries.insert(
                name.clone(),
                (description, input_schema(&spec["params"], &definitions)),
            );
        }
        entries.insert(
            "stop".to_owned(),
            ("Suspend all desktop input now; only the desktop user resumes (`senpi-desktop-engine --resume`)".to_owned(), empty_object()),
        );
        let mut tools = Vec::new();
        let mut methods = HashMap::new();
        for (name, (description, schema)) in entries {
            let tool = tool_name(&name);
            tools.push(json!({ "name": tool, "description": description, "inputSchema": schema }));
            methods.insert(tool, format!("{METHOD_PREFIX}{name}"));
        }
        Self { tools, methods }
    }

    pub fn tools(&self) -> &[Value] {
        &self.tools
    }

    pub fn method(&self, tool: &str) -> Option<&str> {
        self.methods.get(tool).map(String::as_str)
    }
}

/// MCP tool names allow `[A-Za-z0-9_-]`; engine method names use dots.
fn tool_name(method: &str) -> String {
    format!("desktop_{}", method.replace('.', "_"))
}

fn empty_object() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

/// The method's params schema as an object schema, carrying only the
/// definitions it reaches (MCP requires `type: object`).
fn input_schema(params: &Value, definitions: &Map<String, Value>) -> Value {
    let resolved = match params.get("$ref").and_then(Value::as_str) {
        Some(reference) => definitions
            .get(reference.trim_start_matches("#/definitions/"))
            .cloned()
            .unwrap_or_else(empty_object),
        None => params.clone(),
    };
    if resolved.get("type") != Some(&json!("object")) {
        return empty_object();
    }
    let mut reached = Map::new();
    collect_references(&resolved, definitions, &mut reached);
    let mut schema = resolved;
    if !reached.is_empty() {
        if let Some(object) = schema.as_object_mut() {
            object.insert("definitions".to_owned(), Value::Object(reached));
        }
    }
    schema
}

fn collect_references(node: &Value, definitions: &Map<String, Value>, reached: &mut Map<String, Value>) {
    match node {
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_references(item, definitions, reached)),
        Value::Object(object) => {
            if let Some(name) = object
                .get("$ref")
                .and_then(Value::as_str)
                .map(|r| r.trim_start_matches("#/definitions/"))
            {
                if !reached.contains_key(name) {
                    if let Some(definition) = definitions.get(name) {
                        reached.insert(name.to_owned(), definition.clone());
                        collect_references(definition, definitions, reached);
                    }
                }
            }
            object
                .values()
                .for_each(|child| collect_references(child, definitions, reached));
        }
        _ => {}
    }
}
