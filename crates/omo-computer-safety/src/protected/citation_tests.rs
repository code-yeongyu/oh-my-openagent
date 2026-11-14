//! Every `design.tsv` citation points at a real line of the pinned design. Each citation is
//! `d-safety.md:<line>[-<line>] <text>` segments joined by `; `: a segment's quoted strings must
//! appear on its cited lines, and a segment without quotes must carry the row's entry there
//! (backticks of the design text ignored). The lines come from `design-excerpt.txt`, a verbatim
//! copy whose sha256 the test checks against its header and whose line numbers must run
//! 381..=407 in order (the hash covers the text, not the numbering).

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

const DESIGN: &str = include_str!("design.tsv");
const EXCERPT: &str = include_str!("design-excerpt.txt");

/// The pinned lines the excerpt copies: '### The shipped table' from the JSON block to the
/// Windows row.
const EXCERPT_LINES: std::ops::RangeInclusive<u32> = 381..=407;

/// The excerpt's lines by number, after its body hash is checked.
fn excerpt() -> BTreeMap<u32, String> {
    parse(EXCERPT).unwrap_or_else(|error| panic!("design-excerpt.txt: {error}"))
}

/// Parses an excerpt: its body must hash to its header's sha256.
fn parse(excerpt: &str) -> Result<BTreeMap<u32, String>, String> {
    let header = excerpt
        .lines()
        .find_map(|line| line.strip_prefix("# excerpt sha256 "))
        .ok_or("no excerpt sha256 header")?;
    let mut lines = BTreeMap::new();
    let mut body = String::new();
    for line in excerpt.lines().filter(|line| !line.starts_with('#')) {
        let (number, text) = line.split_once('\t').unwrap_or((line, ""));
        let number: u32 = number
            .parse()
            .map_err(|_| format!("line number {number:?}"))?;
        lines.insert(number, text.replace('`', ""));
        body.push_str(text);
        body.push('\n');
    }
    let numbers: Vec<u32> = excerpt
        .lines()
        .filter(|line| !line.starts_with('#'))
        .map(|line| line.split('\t').next().unwrap_or(line).parse().unwrap_or(0))
        .collect();
    if numbers != EXCERPT_LINES.collect::<Vec<u32>>() {
        return Err(format!("line numbers must run {EXCERPT_LINES:?} in order"));
    }
    let digest = format!("{:x}", Sha256::digest(body.as_bytes()));
    if digest != header.trim() {
        return Err("the excerpt was edited".to_owned());
    }
    Ok(lines)
}

/// The shipped excerpt with every line number moved by one: the text and its hash are
/// unchanged, so only the numbering check can catch it.
#[test]
fn a_renumbered_excerpt_is_refused() {
    let renumbered: String = EXCERPT
        .lines()
        .map(|line| match line.split_once('\t') {
            _ if line.starts_with('#') => line.to_owned(),
            Some((number, text)) => {
                format!("{}\t{text}", number.parse::<u32>().expect("number") + 1)
            }
            None => (line.parse::<u32>().expect("number") + 1).to_string(),
        })
        .map(|line| line + "\n")
        .collect();
    assert!(parse(EXCERPT).is_ok(), "the shipped excerpt parses");
    assert!(
        parse(&renumbered).is_err(),
        "a renumbered excerpt must be refused"
    );
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
