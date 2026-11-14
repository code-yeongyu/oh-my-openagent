//! The `ORACLE-DELTAS.tsv` ledger lines the corpus walk reads: the additive members an
//! imported reply may lack, and the replaced values it is compared with.

use serde_json::Value;

use super::crate_path;

/// `(file, member)` for every `additive` ledger line on a top-level result member.
pub(super) fn ledgered_additions() -> Vec<(String, String)> {
    let ledger =
        std::fs::read_to_string(crate_path("parity/ORACLE-DELTAS.tsv")).expect("ORACLE-DELTAS.tsv");
    ledger
        .lines()
        .skip(1)
        .map(|line| line.split('\t').map(str::to_owned).collect::<Vec<_>>())
        .filter(|cells| cells.get(2).map(String::as_str) == Some("additive"))
        .filter_map(|cells| {
            Some((
                cells.first()?.clone(),
                cells.get(1)?.strip_prefix("/result/")?.to_owned(),
            ))
        })
        .collect()
}

/// `(file, member, v3 value)` for every `replaced` ledger line on a top-level result member:
/// the reply is compared with the v3 value the ledger names, not the imported one.
pub(super) fn ledgered_replacements() -> Vec<(String, String, Value)> {
    let ledger =
        std::fs::read_to_string(crate_path("parity/ORACLE-DELTAS.tsv")).expect("ORACLE-DELTAS.tsv");
    ledger
        .lines()
        .skip(1)
        .map(|line| line.split('\t').map(str::to_owned).collect::<Vec<_>>())
        .filter(|cells| cells.get(2).map(String::as_str) == Some("replaced"))
        .filter_map(|cells| {
            Some((
                cells.first()?.clone(),
                cells.get(1)?.strip_prefix("/result/")?.to_owned(),
                serde_json::from_str(cells.get(6)?).ok()?,
            ))
        })
        .collect()
}
