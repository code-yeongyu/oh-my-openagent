//! The table against the design's own inventory: `design-reasons.tsv` lists every
//! `(code, data.reason)` pair the design pin (and row 12's backend defaults) emit, each with
//! its source line and the `COMPUTER_*` member the design names. The inventory is test data
//! extracted from the design, not from the table, so a design pair without a row fails here
//! by name, and so does a row no design line emits. Each pair cites its source line with the
//! line's sha256 (or an `interpretation:I-<n>` marker for a spelling the executor chose):
//! repository lines are checked here, design-pin lines by `check-design-citations.mjs`, which
//! also re-sweeps the pin against this inventory and `design-exclusions.tsv`.

use std::collections::BTreeSet;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::super::{
    lookup, rows, ComputerCode, EngineCode, FailureKey, LayerFailure, Reason, Source,
};

const INVENTORY: &str = include_str!("design-reasons.tsv");
const EXCLUSIONS: &str = include_str!("design-exclusions.tsv");
/// The exact number of inventory pairs: a pair dropped from the table, the reason set and the
/// inventory together still changes this number.
const INVENTORY_PAIRS: usize = 204;
const EXCLUDED_CANDIDATES: usize = 73;

struct DesignPair {
    line: usize,
    refusal: String,
    source: String,
    sha256: String,
    token: String,
    key: Result<FailureKey, String>,
    computer: Option<ComputerCode>,
}

fn parse_key(kind: &str, code: &str, reason: &str) -> Result<FailureKey, String> {
    let source = match kind {
        "engine" => Source::Engine(
            EngineCode::from_wire(code).ok_or(format!("{code} is not a closed engine code"))?,
        ),
        "layer" => Source::Layer(
            LayerFailure::from_wire(code).ok_or(format!("{code} is not a layer failure"))?,
        ),
        other => return Err(format!("kind {other} is neither engine nor layer")),
    };
    let reason = match reason {
        "-" => None,
        token => {
            Some(Reason::from_wire(token).ok_or(format!("the table has no reason token {token}"))?)
        }
    };
    Ok(FailureKey { source, reason })
}

fn design_pairs() -> Vec<DesignPair> {
    INVENTORY
        .lines()
        .enumerate()
        .filter(|(_, line)| is_data(line, "refusal\t"))
        .map(|(index, line)| {
            let cells: Vec<&str> = line.split('\t').collect();
            let cell = |at: usize| cells.get(at).copied().unwrap_or_default();
            DesignPair {
                line: index + 1,
                refusal: cell(0).to_owned(),
                source: cell(5).to_owned(),
                sha256: cell(6).to_owned(),
                token: if cell(3) == "-" {
                    cell(2).to_owned()
                } else {
                    cell(3).to_owned()
                },
                key: parse_key(cell(1), cell(2), cell(3)),
                computer: ComputerCode::from_wire(cell(4)),
            }
        })
        .collect()
}

#[test]
fn every_design_pair_has_its_row() {
    let pairs = design_pairs();
    let mut problems = Vec::new();
    for pair in &pairs {
        let named = format!(
            "{} ({}, inventory line {})",
            pair.refusal, pair.source, pair.line
        );
        match &pair.key {
            Err(why) => problems.push(format!("{named}: no row: {why}")),
            Ok(key) => match lookup(*key) {
                Err(_) => problems.push(format!("{named}: no row for {key:?}")),
                Ok(row) if Some(row.computer) != pair.computer => problems.push(format!(
                    "{named}: the row answers {}, the design names {:?}",
                    row.computer.wire(),
                    pair.computer.map(ComputerCode::wire)
                )),
                Ok(_) => {}
            },
        }
    }
    println!("{} design pairs checked against the table", pairs.len());
    assert_eq!(
        pairs.len(),
        INVENTORY_PAIRS,
        "the inventory has {} pairs",
        pairs.len()
    );
    assert!(
        problems.is_empty(),
        "{} design pairs without their row:\n{}",
        problems.len(),
        problems.join("\n")
    );
}

#[test]
fn every_row_cites_a_design_source() {
    let cited: BTreeSet<FailureKey> = design_pairs()
        .into_iter()
        .filter_map(|pair| pair.key.ok())
        .collect();
    let uncited: Vec<String> = rows()
        .filter(|row| !cited.contains(&row.key))
        .map(|row| {
            format!(
                "{:?} -> {} has no line in design-reasons.tsv",
                row.key,
                row.computer.wire()
            )
        })
        .collect();
    assert!(
        uncited.is_empty(),
        "{} rows no design line emits:\n{}",
        uncited.len(),
        uncited.join("\n")
    );
}

fn is_data(line: &str, header: &str) -> bool {
    !line.starts_with('#') && !line.starts_with(header) && !line.trim().is_empty()
}

fn hex_sha256(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `None` when the citation is well formed (and, for a repository line, true); else the problem.
fn citation_problem(source: &str, sha256: &str, token: &str) -> Option<String> {
    if let Some(number) = source.strip_prefix("interpretation:I-") {
        let known = number.parse::<u8>().is_ok_and(|n| (1..=20).contains(&n));
        return (!known || sha256 != "-")
            .then(|| format!("{source} must be I-1..I-20 with sha256 \"-\""));
    }
    let Some((path, line)) = source.rsplit_once(':') else {
        return Some(format!("{source} is not file:line"));
    };
    let Ok(line) = line.parse::<usize>() else {
        return Some(format!("{source} has no line number"));
    };
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Some(format!("{source} carries no sha256"));
    }
    if path.starts_with("design/") || path.starts_with("waves/") {
        return None;
    }
    if !path.starts_with("crates/") {
        return Some(format!(
            "{source} is neither a design-pin nor a repository path"
        ));
    }
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path);
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    let Some(cited) = text
        .lines()
        .nth(line.saturating_sub(1))
        .filter(|_| line > 0)
    else {
        return Some(format!("{source} does not exist"));
    };
    if hex_sha256(cited) != sha256 {
        return Some(format!(
            "{source} changed: sha256 {} is not the recorded {sha256}",
            hex_sha256(cited)
        ));
    }
    (!cited.contains(token)).then(|| format!("{source} does not contain {token}"))
}

#[test]
fn every_citation_is_a_checked_source() {
    let mut problems: Vec<String> = design_pairs()
        .iter()
        .filter_map(|pair| {
            citation_problem(&pair.source, &pair.sha256, &pair.token)
                .map(|why| format!("{} (inventory line {}): {why}", pair.refusal, pair.line))
        })
        .collect();
    let exclusions: Vec<Vec<&str>> = EXCLUSIONS
        .lines()
        .filter(|line| is_data(line, "name\t"))
        .map(|line| line.split('\t').collect())
        .collect();
    for cells in &exclusions {
        let token = if cells.get(1) == Some(&"<bare>") {
            cells.first()
        } else {
            cells.get(1)
        };
        let cited = citation_problem(
            cells.get(2).copied().unwrap_or_default(),
            cells.get(3).copied().unwrap_or_default(),
            token.copied().unwrap_or_default(),
        );
        if cells.len() != 5 || cells[4].is_empty() || cited.is_some() {
            problems.push(format!(
                "exclusion {cells:?}: {}",
                cited.unwrap_or_else(|| "needs 5 columns and a why".to_owned())
            ));
        }
    }
    assert_eq!(
        exclusions.len(),
        EXCLUDED_CANDIDATES,
        "the exclusion list has {} lines",
        exclusions.len()
    );
    assert!(
        problems.is_empty(),
        "{} citation problems:\n{}",
        problems.len(),
        problems.join("\n")
    );
}
