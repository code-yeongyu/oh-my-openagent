//! The imported corpus against the table: every request it sends names a method of the
//! table, and every params object and reply it pins parses into that row's types. A reply
//! that lacks members the row's result type requires is reported with EVERY such member;
//! the only members it may lack are the ones an `additive` ledger line names for that case.

use serde_json::Value;

use super::crate_path;
use super::ledger::{ledgered_additions, ledgered_replacements};
use super::reply::reply_problem;
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
                match reply_problem(&schema, method, &case.path, &result, &additions) {
                    Ok(true) => ledgered += 1,
                    Ok(false) => {}
                    Err(problem) => problems.push(format!("{}: {name} {problem}", case.name)),
                }
            }
        }
    }
    println!("corpus: {requests} requests, {replies} replies ({ledgered} lacking only a ledgered additive member, type-checked with it filled in), {pushed} notifications checked");
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

/// A reply that lacks a ledgered member is still type-checked on every other member.
#[test]
fn a_ledgered_reply_is_still_type_checked() {
    let schema = engine_schema();
    let additions = ledgered_additions();
    let hello = cases()
        .into_iter()
        .find(|case| case.name == "hello.json")
        .expect("the hello case");
    let mut reply = hello
        .steps
        .iter()
        .flat_map(|step| step["expect"].as_array().cloned().unwrap_or_default())
        .find_map(|entry| entry["message"].get("result").cloned())
        .expect("the hello reply");
    assert!(
        matches!(
            reply_problem(
                &schema,
                Method::EngineHello,
                &hello.path,
                &reply,
                &additions
            ),
            Ok(true)
        ),
        "the imported hello reply lacks only ledgered members and fits"
    );
    reply["protocolVersion"] = serde_json::json!(7);
    let checked = reply_problem(
        &schema,
        Method::EngineHello,
        &hello.path,
        &reply,
        &additions,
    );
    assert!(
        checked.is_err(),
        "a hello reply with a numeric protocolVersion passed: {checked:?}"
    );
}
