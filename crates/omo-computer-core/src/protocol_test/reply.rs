//! The check of one imported reply against its method's result type, with the members an
//! additive ledger line names filled in.

use serde_json::Value;

use super::example::{definition_name, example};
use crate::methods::Method;

/// The method's result definition; a nullable result (`anyOf: [null, $ref]`, the exec
/// reply) is read through its object branch.
pub(super) fn result_definition<'a>(schema: &'a Value, method: &str) -> Option<&'a str> {
    let name = definition_name(&schema["methods"][method]["result"]["$ref"])?;
    Some(
        schema["$defs"][name]["anyOf"]
            .as_array()
            .and_then(|branches| {
                branches
                    .iter()
                    .find_map(|branch| definition_name(&branch["$ref"]))
            })
            .unwrap_or(name),
    )
}

/// Every member the method's result definition requires that the reply does not carry.
pub(super) fn missing_members(schema: &Value, method: &str, reply: &Value) -> Vec<String> {
    let Some(name) = result_definition(schema, method) else {
        return Vec::new();
    };
    let (Some(required), Some(present)) = (
        schema["$defs"][name]["required"].as_array(),
        reply.as_object(),
    ) else {
        return Vec::new();
    };
    required
        .iter()
        .filter_map(Value::as_str)
        .filter(|member| !present.contains_key(*member))
        .map(str::to_owned)
        .collect()
}

/// The check of one imported reply: `Ok(true)` when it lacks only ledgered additive
/// members, `Ok(false)` when it lacks none, and the problem otherwise.
pub(super) fn reply_problem(
    schema: &Value,
    method: Method,
    path: &str,
    result: &Value,
    additions: &[(String, String)],
) -> Result<bool, String> {
    let missing = missing_members(schema, method.spec().name, result);
    let unledgered: Vec<&str> = missing
        .iter()
        .filter(|member| {
            !additions
                .iter()
                .any(|(file, added)| file == path && added == *member)
        })
        .map(String::as_str)
        .collect();
    if !unledgered.is_empty() {
        return Err(format!(
            "result lacks {} member(s) no additive ledger line names: {}",
            unledgered.len(),
            unledgered.join(", ")
        ));
    }
    // The ledgered members are filled with a value of their declared type, so the members
    // the reply does carry are type-checked like any other reply's.
    let mut filled = result.clone();
    if let (Some(object), Some(definition)) = (
        filled.as_object_mut(),
        result_definition(schema, method.spec().name),
    ) {
        for member in &missing {
            let declared = &schema["$defs"][definition]["properties"][member.as_str()];
            object.insert(member.clone(), example(schema, declared));
        }
    }
    method
        .validate_result(filled)
        .map(|()| !missing.is_empty())
        .map_err(|error| {
            if missing.is_empty() {
                format!("result: {error}")
            } else {
                format!(
                    "result (ledgered {} filled in): {error}",
                    missing.join(", ")
                )
            }
        })
}
