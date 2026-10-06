//! Structural validation of the conformance corpus against the committed
//! schema. Replaying the corpus against a running engine is the engine
//! crate's job.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{json, Value};

use super::validator::{definition, Validator};
use super::METHOD_NOT_FOUND;

const REQUIRED_CASES: [&str; 9] = [
    "hello",
    "capabilities",
    "capture-budget",
    "frame-invalidation",
    "stale-ref",
    "stop-path-ladder",
    "stop-path-policy",
    "cancel",
    "rejections",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    description: String,
    scenario: String,
    #[serde(default)]
    env: BTreeMap<String, String>,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    send: Value,
    expect: Vec<Expected>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Expected {
    message: Value,
    #[serde(default)]
    variable: Vec<String>,
}

impl Validator<'_> {
    fn check_reply(&self, message: &Value, method: Option<&String>, at: &str) -> Result<(), String> {
        self.check(&definition("RpcResponse"), message, at)?;
        let method = method.ok_or_else(|| format!("{at}: reply to an id that was never sent"))?;
        if let Some(result) = message.get("result") {
            let result_schema = &self.root["methods"][method.as_str()]["result"];
            self.check(result_schema, result, &format!("{at}/result"))?;
        }
        let error = &message["error"];
        let expected_code = match (&error["data"]["code"], &error["data"]["reason"]) {
            (Value::String(code), _) => self.root["errors"][code.as_str()].clone(),
            (_, Value::String(_)) => json!(METHOD_NOT_FOUND),
            _ => error["code"].clone(),
        };
        if error["code"] == expected_code {
            return Ok(());
        }
        Err(format!(
            "{at}/error/code: {} disagrees with data ({expected_code})",
            error["code"]
        ))
    }

    fn check_case(&self, case: &Case) -> Result<(), String> {
        if case.description.is_empty() || case.steps.is_empty() {
            return Err("a case needs a description and at least one step".to_owned());
        }
        if !case
            .scenario
            .starts_with("crates/senpi-desktop-backend-fake/fixtures/")
        {
            return Err(format!(
                "scenario {} is not a fake-backend fixture",
                case.scenario
            ));
        }
        if let Some(key) = case.env.keys().find(|key| !key.starts_with("SENPI_DESKTOP_")) {
            return Err(format!("env {key} is not an engine variable"));
        }
        let mut sent: HashMap<String, String> = HashMap::new();
        for (index, step) in case.steps.iter().enumerate() {
            let at = format!("steps/{index}");
            self.check(&definition("RpcRequest"), &step.send, &format!("{at}/send"))?;
            let method = step.send["method"].as_str().unwrap_or_default().to_owned();
            if let Some(entry) = self.root["methods"].get(&method) {
                self.check(
                    &entry["params"],
                    &step.send["params"],
                    &format!("{at}/send/params"),
                )?;
            }
            if let Some(id) = step.send.get("id") {
                sent.insert(id.to_string(), method);
            }
            for (slot, expected) in step.expect.iter().enumerate() {
                let at = format!("{at}/expect/{slot}/message");
                let message = &expected.message;
                if let Some(pointer) = expected
                    .variable
                    .iter()
                    .find(|pointer| message.pointer(pointer).is_none())
                {
                    return Err(format!("{at}: variable {pointer} names no member"));
                }
                match message["method"].as_str() {
                    Some(name) => {
                        self.check(&definition("RpcNotification"), message, &at)?;
                        let params_schema = &self.root["notifications"][name]["params"];
                        self.check(params_schema, &message["params"], &format!("{at}/params"))?;
                    }
                    None => self.check_reply(message, sent.get(&message["id"].to_string()), &at)?,
                }
            }
        }
        Ok(())
    }
}

fn crate_path(relative: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative)
}

fn committed_schema() -> Value {
    let text = std::fs::read_to_string(crate_path("schema/engine.schema.json")).unwrap();
    serde_json::from_str(&text).unwrap()
}

#[test]
fn conformance_fixtures_match_schema() {
    // Given
    let schema = committed_schema();
    let validator = Validator { root: &schema };
    let mut paths: Vec<PathBuf> = std::fs::read_dir(crate_path("fixtures/conformance"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "json"))
        .collect();
    paths.sort();
    // When
    let failures: Vec<String> = paths
        .iter()
        .filter_map(|path| {
            let text = std::fs::read_to_string(path).unwrap();
            let verdict = serde_json::from_str::<Case>(&text)
                .map_err(|error| error.to_string())
                .and_then(|case| validator.check_case(&case));
            verdict
                .err()
                .map(|reason| format!("{}: {reason}", path.display()))
        })
        .collect();
    // Then
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    let stems: Vec<String> = paths
        .iter()
        .filter_map(|path| path.file_stem()?.to_str().map(str::to_owned))
        .collect();
    let missing: Vec<&str> = REQUIRED_CASES
        .into_iter()
        .filter(|name| !stems.iter().any(|stem| stem == name))
        .collect();
    assert!(missing.is_empty(), "missing conformance cases: {missing:?}");
}

#[test]
fn a_reply_with_an_unknown_member_is_rejected() {
    // Given
    let schema = committed_schema();
    let validator = Validator { root: &schema };
    let hello = String::from("engine.hello");
    let reply = json!({"jsonrpc": "2.0", "id": 1, "result": {
        "protocolVersion": "1", "engineVersion": "0", "buildSha": "x", "abi": "senpi-desktop/1", "extra": true
    }});
    // When
    let verdict = validator.check_reply(&reply, Some(&hello), "reply");
    // Then
    assert!(verdict.is_err_and(|reason| reason.contains("/result/extra")));
}
