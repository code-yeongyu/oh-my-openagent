//! Every `design.tsv` citation points at a real line of the pinned design. Each citation is
//! `d-safety.md:<line>[-<line>] <text>` segments joined by `; `: a segment's quoted strings must
//! appear on its cited lines, and a segment without quotes must carry the row's entry there
//! (backticks of the design text ignored). The lines come from `design-excerpt.txt`, a verbatim
//! copy whose sha256 the test checks against its header.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

const DESIGN: &str = include_str!("design.tsv");
const EXCERPT: &str = include_str!("design-excerpt.txt");

/// The excerpt's lines by number, after its body hash is checked.
fn excerpt() -> BTreeMap<u32, String> {
    let header = EXCERPT
        .lines()
        .find_map(|line| line.strip_prefix("# excerpt sha256 "))
        .expect("excerpt sha256 header");
    let mut lines = BTreeMap::new();
    let mut body = String::new();
    for line in EXCERPT.lines().filter(|line| !line.starts_with('#')) {
        let (number, text) = line.split_once('\t').unwrap_or((line, ""));
        lines.insert(
            number.parse().expect("a line number"),
            text.replace('`', ""),
        );
        body.push_str(text);
        body.push('\n');
    }
    let digest = format!("{:x}", Sha256::digest(body.as_bytes()));
    assert_eq!(digest, header.trim(), "the excerpt was edited");
    lines
}

fn quotes(segment: &str) -> Vec<&str> {
    segment.split('"').skip(1).step_by(2).collect()
}

fn span(reference: &str) -> (u32, u32) {
    let parse = |n: &str| n.parse::<u32>().unwrap_or_else(|_| panic!("line {n:?}"));
    match reference.split_once('-') {
        Some((from, to)) => (parse(from), parse(to)),
        None => (parse(reference), parse(reference)),
    }
}

#[test]
fn every_design_citation_quotes_its_cited_line() {
    let lines = excerpt();
    let mut wrong = Vec::new();
    for row in DESIGN
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        let fields: Vec<&str> = row.split('\t').collect();
        let (entry, citation) = (fields[2], fields[3]);
        let citation = citation
            .strip_prefix("d-safety.md")
            .expect("cites d-safety.md");
        for segment in citation.split("; ") {
            let segment = segment.strip_prefix(':').expect("a :<line> segment");
            let (reference, text) = segment.split_once(' ').unwrap_or((segment, ""));
            let (from, to) = span(reference);
            let cited: Vec<&String> = (from..=to)
                .map(|n| {
                    lines
                        .get(&n)
                        .unwrap_or_else(|| panic!("line {n} is not in the excerpt"))
                })
                .collect();
            let needles = quotes(text);
            let needles = if needles.is_empty() {
                vec![entry]
            } else {
                needles
            };
            for needle in needles {
                if !cited.iter().any(|line| line.contains(needle)) {
                    wrong.push(format!("{entry}: {needle:?} is not on :{reference}"));
                }
            }
        }
    }
    assert!(
        wrong.is_empty(),
        "{} citations miss their line:\n{}",
        wrong.len(),
        wrong.join("\n")
    );
}
