//! The token delta of every diff fixture is recorded, not asserted (`v3-diff-tokens.json`):
//! this test keeps the record equal to what the reads produce. Regenerate with
//! `OMO_COMPUTER_UPDATE_DIFF_TOKENS=1 cargo test -p omo-computer-session diff_tokens`.

use serde_json::{json, Value};

use super::{fixture, run};
use crate::refs::RefRegistry;

const RECORD: &str = "src/observe/tests/v3-diff-tokens.json";
const FIXTURES: &[&str] = &["v3-ax-diff-one-title-change.json", "v3-ax-diff-reorder-full-tree.json"];

/// The CI's token estimate: one token per four characters, rounded up.
fn tokens(text: &str) -> usize {
    text.chars().count().div_ceil(4)
}

fn measure(name: &str) -> Value {
    let mut fake = fixture(name);
    let mut refs = RefRegistry::default();
    let first = run(&mut refs, &mut fake, json!({"target": "101"}));
    let second = run(&mut refs, &mut fake, json!({"target": "101", "since": first.generation}));
    let full = refs.generation("101", second.generation).and_then(|g| g.outline.as_ref()).map(|o| tokens(&o.text())).expect("outline");
    let diff = second.diff.as_deref().map(tokens);
    let float = |count: usize| f64::from(u32::try_from(count).unwrap_or(u32::MAX));
    let ratio = diff.map(|diff| format!("{:.3}", float(diff) / float(full)));
    json!({"fixture": name, "fullTokens": full, "diffTokens": diff, "ratio": ratio, "diffFallback": second.diff_fallback})
}

#[test]
fn diff_tokens_are_recorded_per_fixture() {
    let measured = Value::Array(FIXTURES.iter().map(|name| measure(name)).collect());
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(RECORD);
    let text = format!("{}\n", serde_json::to_string_pretty(&measured).expect("json"));
    if std::env::var_os("OMO_COMPUTER_UPDATE_DIFF_TOKENS").is_some() {
        std::fs::write(&path, &text).expect("write the record");
    }
    let recorded = std::fs::read_to_string(&path).expect("the record exists");
    assert_eq!(recorded, text, "the token record is stale; regenerate it");
}
