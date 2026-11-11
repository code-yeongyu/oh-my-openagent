//! The imported corpus against the table: every request it sends names a method of the
//! table, and every params object and reply it pins parses into that row's types. A reply
//! that lacks members the row's result type requires is reported with EVERY such member;
//! the only members it may lack are the ones an `additive` ledger line names for that case.

use serde_json::Value;

use super::crate_path;
use crate::methods::{notification_schemas, Method};
use crate::schema::engine_schema;

const CORPORA: &[&str] = &[
    "fixtures/conformance",
    "../omo-computer-engine/tests/fixtures/v1-consumers",
];
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

struct Case {
    path: String,
    name: String,
    transport: String,
    steps: Vec<Value>,
}

fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for corpus in CORPORA {
        let mut paths: Vec<_> = std::fs::read_dir(crate_path(corpus))
            .expect("corpus directory")
            .flatten()
            .map(|entry| entry.path())
            .collect();
        paths.sort();
        for path in paths
            .into_iter()
            .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        {
            let case: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).expect("read case"))
                    .expect("case is JSON");
            cases.push(Case {
                path: format!(
                    "crates/omo-computer-core/{corpus}/{}",
                    path.file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default()
                )
                .replace("crates/omo-computer-core/../", "crates/"),
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                transport: case["transport"].as_str().unwrap_or("stdio").to_owned(),
                steps: case["steps"].as_array().cloned().unwrap_or_default(),
            });
        }
    }
    cases
}

/// `(file, member)` for every `additive` ledger line on a top-level result member.
fn ledgered_additions() -> Vec<(String, String)> {
    let ledger =
        std::fs::read_to_string(crate_path("parity/ORACLE-DELTAS.tsv")).expect("ORACLE-DELTAS.tsv");
    ledger
        .lines()
        .skip(1)
        .map(|line| line.split('\t').map(str::to_owned).collect::<Vec<_>>())
        .filter(|cells| cells.get(2).map(String::as_str) == Some("additive"))
        .filter_map(|cells| {
            Some((
                cells.first()?.clone(),
                cells.get(1)?.strip_prefix("/result/")?.to_owned(),
            ))
        })
        .collect()
}

/// `(file, member, v3 value)` for every `replaced` ledger line on a top-level result member:
/// the reply is compared with the v3 value the ledger names, not the imported one.
fn ledgered_replacements() -> Vec<(String, String, Value)> {
    let ledger =
        std::fs::read_to_string(crate_path("parity/ORACLE-DELTAS.tsv")).expect("ORACLE-DELTAS.tsv");
    ledger
        .lines()
        .skip(1)
        .map(|line| line.split('\t').map(str::to_owned).collect::<Vec<_>>())
        .filter(|cells| cells.get(2).map(String::as_str) == Some("replaced"))
        .filter_map(|cells| {
            Some((
                cells.first()?.clone(),
                cells.get(1)?.strip_prefix("/result/")?.to_owned(),
                serde_json::from_str(cells.get(6)?).ok()?,
            ))
        })
        .collect()
}

fn definition_name(reference: &Value) -> Option<&str> {
    reference.as_str()?.strip_prefix("#/$defs/")
}

/// Every member the method's result definition requires that the reply does not carry. A
/// nullable result (`anyOf: [null, $ref]`, the exec reply) is read through its object branch.
fn missing_members(schema: &Value, method: &str, reply: &Value) -> Vec<String> {
    let Some(mut name) = definition_name(&schema["methods"][method]["result"]["$ref"]) else {
        return Vec::new();
    };
    if let Some(branch) = schema["$defs"][name]["anyOf"]
        .as_array()
        .and_then(|branches| {
            branches
                .iter()
                .find_map(|branch| definition_name(&branch["$ref"]))
        })
    {
        name = branch;
    }
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

fn error_code(expect: &[Value]) -> Option<i64> {
    expect
        .iter()
        .find_map(|entry| entry["message"]["error"]["code"].as_i64())
}

#[test]
fn corpus_requests_name_table_methods_and_fit_their_types() {
    let notifications: Vec<&str> = notification_schemas(&mut schemars::SchemaGenerator::default())
        .into_iter()
        .map(|(name, _)| name)
        .collect();
    let additions = ledgered_additions();
    let replacements = ledgered_replacements();
    let schema = engine_schema();
    let (mut requests, mut replies, mut pushed, mut ledgered) = (0, 0, 0, 0);
    let mut problems = Vec::new();
    for case in cases().into_iter().filter(|case| case.transport != "mcp") {
        for step in &case.steps {
            let expect = step["expect"].as_array().cloned().unwrap_or_default();
            for entry in &expect {
                if let Some(name) = entry["message"]["method"].as_str() {
                    pushed += 1;
                    if !notifications.contains(&name) {
                        problems.push(format!(
                            "{}: notification {name} is not declared",
                            case.name
                        ));
                    }
                }
            }
            let Some(name) = step["send"]["method"].as_str() else {
                continue;
            };
            let code = error_code(&expect);
            let method = if case.transport == "oneshot" {
                Method::from_oneshot(name)
            } else {
                Method::from_name(name)
            };
            let Some(method) = method else {
                if code != Some(METHOD_NOT_FOUND) {
                    problems.push(format!("{}: {name} is not in the method table", case.name));
                }
                continue;
            };
            requests += 1;
            let params = step["send"]
                .get("params")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            if code != Some(INVALID_PARAMS) {
                if let Err(error) = method.validate_params(params) {
                    problems.push(format!("{}: {name} params: {error}", case.name));
                }
            }
            for imported in expect
                .iter()
                .filter_map(|entry| entry["message"].get("result"))
            {
                replies += 1;
                let mut result = imported.clone();
                for (_, member, v3) in replacements.iter().filter(|(file, ..)| *file == case.path) {
                    if let Some(slot) = result.get_mut(member.as_str()) {
                        *slot = v3.clone();
                    }
                }
                let result = &result;
                let missing = missing_members(&schema, method.spec().name, result);
                let unledgered: Vec<&str> = missing
                    .iter()
                    .filter(|member| {
                        !additions
                            .iter()
                            .any(|(file, added)| *file == case.path && added == *member)
                    })
                    .map(String::as_str)
                    .collect();
                if !unledgered.is_empty() {
                    problems.push(format!(
                        "{}: {name} result lacks {} member(s) no additive ledger line names: {}",
                        case.name,
                        unledgered.len(),
                        unledgered.join(", ")
                    ));
                } else if !missing.is_empty() {
                    ledgered += 1;
                } else if let Err(error) = method.validate_result(result.clone()) {
                    problems.push(format!("{}: {name} result: {error}", case.name));
                }
            }
        }
    }
    println!("corpus: {requests} requests, {replies} replies ({ledgered} lacking only a ledgered additive member), {pushed} notifications checked");
    assert!(
        requests > 100 && replies > 50,
        "the corpus walk read too little: {requests} requests, {replies} replies"
    );
    assert!(
        problems.is_empty(),
        "{} corpus mismatches:\n{}",
        problems.len(),
        problems.join("\n")
    );
}
