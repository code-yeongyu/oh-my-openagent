//! The `--mcp` tool catalog, generated from the method table: every `Exposure::Public` row
//! except the `$/` protocol rows, named `desktop_<method>` (MCP tool names allow no dots), plus
//! the v1 stop verb `desktop_stop`. Host-only and test-only tools do not exist.

use std::collections::BTreeMap;

use omo_computer_core::methods::{Exposure, METHODS};
use omo_computer_core::schema::engine_schema_text;
use serde_json::{json, Map, Value};

use crate::bridge::METHOD_PREFIX;

const STOP_TOOL: &str = "desktop_stop";

pub struct Catalog {
    tools: Vec<Value>,
    methods: BTreeMap<String, String>,
}

fn tool_name(method: &str) -> String {
    format!("desktop_{}", method.replace('.', "_"))
}

fn empty_object() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

impl Catalog {
    #[must_use]
    pub fn new() -> Self {
        let schema: Value = serde_json::from_str(&engine_schema_text()).unwrap_or_default();
        let defs = schema["$defs"].as_object().cloned().unwrap_or_default();
        let mut entries: BTreeMap<String, (String, Value)> = METHODS
            .iter()
            .filter(|row| row.exposure == Exposure::Public && !row.name.starts_with("$/"))
            .map(|row| {
                let params = &schema["methods"][row.name]["params"];
                let description = format!("omo-computer-engine `{}` ({})", row.name, schema["methods"][row.name]["effect"].as_str().unwrap_or("read"));
                (tool_name(row.name), (format!("{METHOD_PREFIX}{}", row.name), json!({ "description": description, "inputSchema": input_schema(params, &defs) })))
            })
            .collect();
        entries.insert(
            STOP_TOOL.to_owned(),
            (
                format!("{METHOD_PREFIX}stop"),
                json!({ "description": "Suspend all desktop input now; only the desktop user resumes", "inputSchema": empty_object() }),
            ),
        );
        let mut tools = Vec::new();
        let mut methods = BTreeMap::new();
        for (name, (method, mut tool)) in entries {
            tool["name"] = json!(name);
            tools.push(tool);
            methods.insert(name, method);
        }
        Self { tools, methods }
    }

    #[must_use]
    pub fn tools(&self) -> &[Value] {
        &self.tools
    }

    /// The `desktop.<method>` a tool calls.
    #[must_use]
    pub fn method(&self, tool: &str) -> Option<&str> {
        self.methods.get(tool).map(String::as_str)
    }
}

/// The params schema as an object schema carrying only the definitions it reaches.
fn input_schema(params: &Value, defs: &Map<String, Value>) -> Value {
    let resolved = match params.get("$ref").and_then(Value::as_str) {
        Some(reference) => defs.get(reference.trim_start_matches("#/$defs/")).cloned().unwrap_or_else(empty_object),
        None => params.clone(),
    };
    if resolved.get("type") != Some(&json!("object")) {
        return empty_object();
    }
    let mut reached = Map::new();
    collect(&resolved, defs, &mut reached);
    let mut schema = resolved;
    if !reached.is_empty() {
        schema["$defs"] = Value::Object(reached);
    }
    schema
}

fn collect(node: &Value, defs: &Map<String, Value>, reached: &mut Map<String, Value>) {
    match node {
        Value::Array(items) => items.iter().for_each(|item| collect(item, defs, reached)),
        Value::Object(object) => {
            if let Some(name) = object.get("$ref").and_then(Value::as_str).map(|r| r.trim_start_matches("#/$defs/")) {
                if let (false, Some(definition)) = (reached.contains_key(name), defs.get(name)) {
                    reached.insert(name.to_owned(), definition.clone());
                    collect(definition, defs, reached);
                }
            }
            object.values().for_each(|child| collect(child, defs, reached));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_only_tools_do_not_exist_and_the_stop_tool_does() {
        let catalog = Catalog::new();
        assert_eq!(catalog.method("desktop_stop"), Some("desktop.stop"));
        assert_eq!(catalog.method("desktop_ax_snapshot"), Some("desktop.ax.snapshot"));
        assert!(catalog.method("desktop_session_open").is_none());
        assert!(catalog.method("desktop_stopPath_resume").is_none());
        assert!(catalog.tools().iter().all(|tool| tool["inputSchema"]["type"] == json!("object")));
    }
}
