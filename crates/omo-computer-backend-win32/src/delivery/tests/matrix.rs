//! Every timing and family constant of the drop matrix cites a row of the spike's probe ledger
//! (`probes/win32-delivery.tsv`, spike row 7 / #13145); a constant without a row is a guess.

const MATRIX: &str = include_str!("../matrix.tsv");
const LEDGER: &str = "probes/win32-delivery.tsv";

#[test]
fn matrix_constants_cite_probe_rows() {
    let ledger = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/probes/win32-delivery.tsv"))
        .unwrap_or_default();
    let probe_ids: Vec<&str> = ledger.lines().skip(1).filter_map(|line| line.split('\t').next()).collect();
    assert!(!probe_ids.is_empty(), "{LEDGER} has rows (it lands with spike row 7, #13145)");
    let rows: Vec<&str> = MATRIX.lines().skip(1).filter(|line| !line.trim().is_empty()).collect();
    assert!(!rows.is_empty(), "the matrix is data");
    for row in rows {
        let cite = row.rsplit('\t').next().unwrap_or_default();
        let id = cite.strip_prefix("win32-delivery:").unwrap_or_default();
        assert!(probe_ids.contains(&id), "{row}: cites no ledger row");
    }
}
