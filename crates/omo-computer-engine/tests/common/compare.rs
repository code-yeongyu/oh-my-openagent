//! A reply compared with a case's expected message, modulo the case's `variable` pointers and
//! the ORACLE-DELTAS.tsv lines that apply to the case (row 3's rule): an `additive` line accepts
//! an extra member only where its pattern matches, a member the expectation lists is always
//! compared exactly, and a `replaced` line moves the expected value at its pointer to its v3 value.

use std::collections::HashSet;
use std::fs;

use serde_json::Value;

use super::case::repo;

pub const DELTAS: &str = "crates/omo-computer-core/parity/ORACLE-DELTAS.tsv";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Additive,
    Replaced,
}

#[derive(Debug, Clone)]
pub struct Delta {
    pub line: String,
    pub kind: Kind,
    pattern: Vec<String>,
    imported: Value,
    v3: Value,
    pub matched: usize,
}

fn segments(pointer: &str) -> Vec<String> {
    pointer.split('/').skip(1).map(|seg| seg.replace("~1", "/").replace("~0", "~")).collect()
}

fn child(pointer: &str, key: &str) -> String {
    format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"))
}

fn fits(pattern: &[String], path: &[String]) -> bool {
    pattern.len() == path.len() && pattern.iter().zip(path).all(|(pat, seg)| pat == "*" || pat == seg)
}

fn matches(pattern: &[String], pointer: &str) -> bool {
    let path = segments(pointer);
    match pattern.split_first() {
        Some((first, rest)) if first == "**" => path.len() >= rest.len() && fits(rest, &path[path.len() - rest.len()..]),
        _ => fits(pattern, &path),
    }
}

fn parse_value(kind: Kind, text: &str, pointer: &str) -> Value {
    match kind {
        Kind::Additive => Value::Null,
        Kind::Replaced => serde_json::from_str(text).unwrap_or_else(|error| panic!("replaced value of {pointer}: {error}")),
    }
}

pub fn load(name: &str) -> Vec<Delta> {
    let text = fs::read_to_string(repo().join(DELTAS)).expect("the delta ledger is readable");
    text.lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let cols: Vec<&str> = line.split('\t').collect();
            let col = |i: usize| cols.get(i).copied().unwrap_or("");
            if col(0) != "*" && col(0) != name {
                return None;
            }
            let kind = match col(2) {
                "additive" => Kind::Additive,
                "replaced" => Kind::Replaced,
                _ => return None,
            };
            let pointer = col(1);
            let pattern = pointer.strip_prefix('/').unwrap_or(pointer).split('/').map(str::to_owned).collect();
            Some(Delta {
                line: line.to_owned(),
                kind,
                pattern,
                imported: parse_value(kind, col(5), pointer),
                v3: parse_value(kind, col(6), pointer),
                matched: 0,
            })
        })
        .collect()
}

pub struct Context<'a> {
    pub variable: HashSet<&'a str>,
    pub deltas: &'a mut [Delta],
    pub failures: Vec<String>,
}

impl Context<'_> {
    fn fail(&mut self, pointer: &str, detail: String) {
        let at = if pointer.is_empty() { "/" } else { pointer };
        self.failures.push(format!("{at}: {detail}"));
    }
}

pub fn compare(expected: &Value, actual: Option<&Value>, pointer: &str, ctx: &mut Context<'_>) {
    if ctx.variable.contains(pointer) {
        return;
    }
    let replaced = ctx
        .deltas
        .iter_mut()
        .find(|d| d.kind == Kind::Replaced && matches(&d.pattern, pointer) && d.imported == *expected);
    let expected = match replaced {
        Some(delta) => {
            delta.matched += 1;
            delta.v3.clone()
        }
        None => expected.clone(),
    };
    let Some(actual) = actual else {
        return ctx.fail(pointer, format!("missing, expected {expected}"));
    };
    match (&expected, actual) {
        (Value::Object(want), Value::Object(got)) => {
            for (key, value) in want {
                compare(value, got.get(key), &child(pointer, key), ctx);
            }
            for (key, value) in got.iter().filter(|(key, _)| !want.contains_key(*key)) {
                let at = child(pointer, key);
                if ctx.variable.contains(at.as_str()) {
                    continue;
                }
                match ctx.deltas.iter_mut().find(|d| d.kind == Kind::Additive && matches(&d.pattern, &at)) {
                    Some(delta) => delta.matched += 1,
                    None => ctx.fail(&at, format!("unexpected member {value} (no ORACLE-DELTAS line matches it)")),
                }
            }
        }
        (Value::Array(want), Value::Array(got)) if want.len() != got.len() => {
            ctx.fail(pointer, format!("expected {} items, got {}", want.len(), got.len()));
        }
        (Value::Array(want), Value::Array(got)) => {
            for (index, (item, actual)) in want.iter().zip(got).enumerate() {
                compare(item, Some(actual), &child(pointer, &index.to_string()), ctx);
            }
        }
        _ if expected != *actual => ctx.fail(pointer, format!("expected {expected} got {actual}")),
        _ => {}
    }
}
