//! A corpus case as the engine-side replay reads it: transport, scenario, env, planted runtime
//! state and steps. The format is the one `script/qa/computer/replay.ts` drives; this harness is
//! written fresh for the engine's own tests (the old `tests/common` is not reused).

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

pub fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Stdio,
    Mcp,
    Oneshot,
}

impl Transport {
    pub const fn args(self) -> &'static [&'static str] {
        match self {
            Self::Stdio => &["--stdio"],
            Self::Mcp => &["--mcp"],
            Self::Oneshot => &["--oneshot"],
        }
    }
}

#[derive(Debug, Clone)]
pub struct Expectation {
    pub message: Value,
    pub variable: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum Step {
    Restart,
    Send {
        send: Value,
        expect: Vec<Expectation>,
        sink: Option<usize>,
    },
}

#[derive(Debug, Clone)]
pub struct Plant {
    pub path: String,
    /// `None` plants a directory.
    pub content: Option<String>,
    pub mode: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct Case {
    /// The repository-relative path the case was read from.
    pub name: String,
    pub transport: Transport,
    pub scenario: Option<String>,
    pub env: Vec<(String, String)>,
    pub plant: Vec<Plant>,
    pub host: Option<Value>,
    pub steps: Vec<Step>,
}

/// Whether `ORACLE-PROVENANCE.tsv` lists `name` as an imported oracle case.
pub fn is_imported(name: &str) -> bool {
    let manifest = repo().join("crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv");
    let text = fs::read_to_string(&manifest).expect("the provenance manifest is readable");
    text.lines()
        .skip(1)
        .any(|row| row.split('\t').next() == Some(name))
}

fn strings(value: Option<&Value>, what: &str) -> Vec<String> {
    value.map_or_else(Vec::new, |value| {
        value
            .as_array()
            .unwrap_or_else(|| panic!("{what} must be an array"))
            .iter()
            .map(|item| {
                item.as_str()
                    .unwrap_or_else(|| panic!("{what} must hold strings"))
                    .to_owned()
            })
            .collect()
    })
}

fn step(raw: &Value, index: usize, name: &str) -> Step {
    let at = format!("{name} step {}", index + 1);
    if raw["restart"] == Value::Bool(true) {
        return Step::Restart;
    }
    let expect = raw["expect"]
        .as_array()
        .unwrap_or_else(|| panic!("{at} needs expect[]"));
    let expect = expect
        .iter()
        .map(|item| Expectation {
            message: item
                .get("message")
                .cloned()
                .unwrap_or_else(|| panic!("{at}: an expectation needs message")),
            variable: strings(item.get("variable"), &format!("{at} variable")),
        })
        .collect();
    let sink = raw.get("sink").map(|count| {
        let count = count
            .as_u64()
            .unwrap_or_else(|| panic!("{at}: sink must be a count"));
        usize::try_from(count).expect("a sink count fits usize")
    });
    let send = raw.get("send").filter(|send| send.is_object()).cloned();
    Step::Send {
        send: send.unwrap_or_else(|| panic!("{at} needs send")),
        expect,
        sink,
    }
}

fn plant(raw: &Value, name: &str) -> Vec<Plant> {
    let Some(items) = raw.get("runtime").map(|runtime| &runtime["plant"]) else {
        return Vec::new();
    };
    let items = items
        .as_array()
        .unwrap_or_else(|| panic!("{name}: runtime must be {{ plant: [...] }}"));
    items
        .iter()
        .map(|item| {
            let path = item["path"]
                .as_str()
                .unwrap_or_else(|| panic!("{name}: a plant needs a path"));
            assert!(
                !path.is_empty()
                    && !Path::new(path).is_absolute()
                    && !path.split('/').any(|seg| seg == ".."),
                "{name}: plant path {path} must stay inside the runtime dir"
            );
            let content = item["content"].as_str().map(str::to_owned);
            assert_eq!(
                item["dir"] == Value::Bool(true),
                content.is_none(),
                "{name}: {path} needs content or dir"
            );
            let mode = item["mode"]
                .as_str()
                .map(|mode| u32::from_str_radix(mode, 8).expect("an octal mode"));
            Plant {
                path: path.to_owned(),
                content,
                mode,
            }
        })
        .collect()
}

pub fn load(name: &str) -> Case {
    let text =
        fs::read_to_string(repo().join(name)).unwrap_or_else(|error| panic!("{name}: {error}"));
    let raw: Value =
        serde_json::from_str(&text).unwrap_or_else(|error| panic!("{name} is not JSON: {error}"));
    let transport = match raw.get("transport").and_then(Value::as_str) {
        Some("stdio") => Transport::Stdio,
        Some("mcp") => Transport::Mcp,
        Some("oneshot") => Transport::Oneshot,
        Some(other) => panic!("{name}: unknown transport {other}"),
        None if is_imported(name) => Transport::Stdio,
        None => panic!(
            "transport_missing: {name} names no transport and is not an imported oracle case"
        ),
    };
    let env = raw
        .get("env")
        .and_then(Value::as_object)
        .map_or_else(Vec::new, |env| {
            env.iter()
                .map(|(key, value)| {
                    (
                        key.clone(),
                        value.as_str().expect("env values are strings").to_owned(),
                    )
                })
                .collect()
        });
    let steps = raw["steps"]
        .as_array()
        .unwrap_or_else(|| panic!("{name}: steps must be an array"));
    Case {
        name: name.to_owned(),
        transport,
        scenario: raw
            .get("scenario")
            .and_then(Value::as_str)
            .map(str::to_owned),
        env,
        plant: plant(&raw, name),
        host: raw.get("host").cloned(),
        steps: steps
            .iter()
            .enumerate()
            .map(|(index, raw)| step(raw, index, name))
            .collect(),
    }
}
