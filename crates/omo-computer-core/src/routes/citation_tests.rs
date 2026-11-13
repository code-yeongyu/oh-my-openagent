//! Every seed row of `data/toolkit-routes.json` cites a design-pin line that names its key. The
//! lines come from `design-excerpt.txt`, a verbatim copy whose body hash the test checks against
//! its header (the pin lives outside the repository). The macOS membership ids carry a dual
//! citation until the re-pin writes them into d-macos: its first half must be an excerpt line and
//! that line must carry the second half's source path.

use std::collections::BTreeMap;

use serde_json::Value;
use sha2::{Digest, Sha256};

const EXCERPT: &str = include_str!("design-excerpt.txt");

fn excerpt() -> BTreeMap<String, String> {
    let header = EXCERPT
        .lines()
        .find_map(|line| line.strip_prefix("# excerpt sha256 "))
        .expect("an excerpt sha256 header");
    let mut lines = BTreeMap::new();
    let mut body = String::new();
    for line in EXCERPT.lines().filter(|line| !line.starts_with('#')) {
        let (cite, text) = line.split_once('\t').expect("<cite>\\t<text>");
        lines.insert(cite.to_owned(), text.to_owned());
        body.push_str(text);
        body.push('\n');
    }
    assert_eq!(format!("{:x}", Sha256::digest(body.as_bytes())), header.trim(), "the excerpt was edited");
    lines
}

#[test]
fn every_seed_citation_resolves_in_the_pin() {
    let lines = excerpt();
    let seed: Value = serde_json::from_str(super::SEED).expect("seed json");
    let rows = seed["routes"].as_array().expect("routes");
    assert!(!rows.is_empty());
    for row in rows {
        let (key, cite) = (row["key"].as_str().expect("key"), row["cite"].as_str().expect("cite"));
        let text = lines.get(cite).unwrap_or_else(|| panic!("{key}: {cite} is not an excerpt line"));
        assert!(text.contains(key), "{key} is not on {cite}");
    }
    for os in ["windows", "x11"] {
        let entry = &seed["membership"][os];
        let cite = entry["cite"].as_str().expect("cite");
        let text = lines.get(cite).unwrap_or_else(|| panic!("{os}: {cite}"));
        for field in ["exact", "exactWmClass"] {
            for key in entry[field].as_array().into_iter().flatten() {
                let key = key.as_str().expect("key");
                assert!(text.contains(key), "{key} is not on {cite}");
            }
        }
    }
    let macos = seed["membership"]["macos"]["cite"].as_array().expect("dual citation");
    let first = macos[0].as_str().expect("pin half");
    let source = macos[1].as_str().expect("source half");
    let path = source.split(':').next().expect("a source path");
    assert!(lines.get(first).is_some_and(|text| text.contains(path)), "{first} does not carry {path}");
}
