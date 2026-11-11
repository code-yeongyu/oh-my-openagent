//! The table against the design's own inventory: `design-reasons.tsv` lists every
//! `(code, data.reason)` pair the design pin (and row 12's backend defaults) emit, each with
//! its source line and the `COMPUTER_*` member the design names. The inventory is test data
//! extracted from the design, not from the table, so a design pair without a row fails here
//! by name, and so does a row no design line emits.

use std::collections::BTreeSet;

use super::super::{lookup, rows, ComputerCode, EngineCode, FailureKey, LayerFailure, Reason, Source};

const INVENTORY: &str = include_str!("design-reasons.tsv");

struct DesignPair {
    line: usize,
    refusal: String,
    source: String,
    key: Result<FailureKey, String>,
    computer: Option<ComputerCode>,
}

fn parse_key(kind: &str, code: &str, reason: &str) -> Result<FailureKey, String> {
    let source = match kind {
        "engine" => Source::Engine(EngineCode::from_wire(code).ok_or(format!("{code} is not a closed engine code"))?),
        "layer" => Source::Layer(LayerFailure::from_wire(code).ok_or(format!("{code} is not a layer failure"))?),
        other => return Err(format!("kind {other} is neither engine nor layer")),
    };
    let reason = match reason {
        "-" => None,
        token => Some(Reason::from_wire(token).ok_or(format!("the table has no reason token {token}"))?),
    };
    Ok(FailureKey { source, reason })
}

fn design_pairs() -> Vec<DesignPair> {
    INVENTORY
        .lines()
        .enumerate()
        .filter(|(_, line)| !line.starts_with('#') && !line.starts_with("refusal\t") && !line.trim().is_empty())
        .map(|(index, line)| {
            let cells: Vec<&str> = line.split('\t').collect();
            let cell = |at: usize| cells.get(at).copied().unwrap_or_default();
            DesignPair {
                line: index + 1,
                refusal: cell(0).to_owned(),
                source: cell(5).to_owned(),
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
        let named = format!("{} ({}, inventory line {})", pair.refusal, pair.source, pair.line);
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
    assert!(pairs.len() >= 190, "the inventory shrank to {} lines", pairs.len());
    assert!(problems.is_empty(), "{} design pairs without their row:\n{}", problems.len(), problems.join("\n"));
}

#[test]
fn every_row_cites_a_design_source() {
    let cited: BTreeSet<FailureKey> = design_pairs().into_iter().filter_map(|pair| pair.key.ok()).collect();
    let uncited: Vec<String> = rows()
        .filter(|row| !cited.contains(&row.key))
        .map(|row| format!("{:?} -> {} has no line in design-reasons.tsv", row.key, row.computer.wire()))
        .collect();
    assert!(uncited.is_empty(), "{} rows no design line emits:\n{}", uncited.len(), uncited.join("\n"));
}
