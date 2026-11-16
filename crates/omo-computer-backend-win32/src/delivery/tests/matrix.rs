//! The drop matrix is data whose every row rests on something: a row that DELIVERS cites a row of
//! the spike's probe ledger (`probes/win32-delivery.tsv`, spike row 7 / #13145); a REFUSAL the
//! spike did not measure cites the design's harvest id instead (a refusal sends nothing, so it is
//! safe without a measurement); a constant without either is a guess. The barrier's timing
//! constants cite ledger rows too. A cited ledger id must have a measured row: an id whose every
//! row reads `UNMEASURED` (NOT-RUN) proves nothing.

use crate::delivery::matrix::parse;

const MATRIX: &str = include_str!("../matrix.tsv");
const BARRIER: &str = include_str!("../../barrier.rs");
const LEDGER: &str = "probes/win32-delivery.tsv";

/// The ledger ids with at least one measured row (verdict column not `UNMEASURED`).
fn probe_ids() -> Vec<String> {
    let ledger = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/probes/win32-delivery.tsv"
    ))
    .unwrap_or_default();
    ledger
        .lines()
        .skip(1)
        .filter(|line| line.split('\t').nth(4).is_some_and(|verdict| verdict != "UNMEASURED"))
        .filter_map(|line| line.split('\t').next())
        .map(str::to_owned)
        .collect()
}

#[test]
fn matrix_constants_cite_probe_rows() {
    let probe_ids = probe_ids();
    assert!(
        !probe_ids.is_empty(),
        "{LEDGER} has rows (it lands with spike row 7, #13145)"
    );
    let rows: Vec<&str> = MATRIX
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .collect();
    assert!(!rows.is_empty(), "the matrix is data");
    for row in rows {
        let cite = row.rsplit('\t').next().unwrap_or_default();
        let refuses = row.split('\t').nth(2).is_some_and(|verbs| verbs != "-");
        match (
            cite.strip_prefix("win32-delivery:"),
            cite.strip_prefix("design:"),
        ) {
            (Some(id), _) => assert!(
                probe_ids.iter().any(|known| known == id),
                "{row}: cites no measured ledger row"
            ),
            (None, Some(id)) => assert!(
                refuses && !id.is_empty(),
                "{row}: only a refusal may rest on the design"
            ),
            (None, None) => panic!("{row}: cites nothing"),
        }
    }
    let cited: Vec<&str> = BARRIER
        .split("win32-delivery:")
        .skip(1)
        .filter_map(|rest| rest.split([',', ')', ' ', '\n']).next())
        .collect();
    assert!(cited.len() >= 3, "the barrier's constants cite the ledger");
    for id in cited {
        assert!(
            probe_ids.iter().any(|known| known == id),
            "barrier.rs cites {id}, not a measured ledger row"
        );
    }
}

#[test]
fn matrix_rows_parse() {
    let rows = parse().expect("every line of matrix.tsv is a row");
    assert_eq!(
        rows.len(),
        MATRIX
            .lines()
            .skip(1)
            .filter(|line| !line.trim().is_empty())
            .count()
    );
}
