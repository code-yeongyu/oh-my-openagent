//! Every value an imported case expects for a member of `ActionReport` or `Disposition`
//! parses into the contract's type, or a `replaced` line of the oracle ledger names it.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::listing::Surface;
use crate::methods::Method;
use crate::report::{
    Delivered, Disposition, Effect, Evidence, FocusRestoration, Hit, Route, Timings, VerbClass,
};
use crate::untrusted::UntrustedText;

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn fits<T: DeserializeOwned>(value: &Value) -> bool {
    serde_json::from_value::<T>(value.clone()).is_ok()
}

/// Whether `value` parses into the contract's type of the `ActionReport` member `member`.
fn member_fits(member: &str, value: &Value) -> Option<bool> {
    Some(match member {
        "disposition" => fits::<Disposition>(value),
        "delivered" => fits::<Delivered>(value),
        "effect" => fits::<Effect>(value),
        "route" => fits::<Route>(value),
        "hit" => fits::<Hit>(value),
        "focusRestoration" => fits::<FocusRestoration>(value),
        "openedSurfaces" => fits::<Vec<Surface>>(value),
        "nextCall" | "note" | "warning" => fits::<String>(value),
        "auditIds" => fits::<Vec<String>>(value),
        "timings" => fits::<Timings>(value),
        "evidence" => fits::<Vec<Evidence>>(value),
        "observation" => fits::<UntrustedText>(value),
        _ => return None,
    })
}

struct Replaced {
    file: String,
    pointer: String,
    imported: Value,
    v3: Value,
}

fn replaced_lines() -> Vec<Replaced> {
    let ledger = std::fs::read_to_string(repo_path(
        "crates/omo-computer-core/parity/ORACLE-DELTAS.tsv",
    ))
    .expect("ORACLE-DELTAS.tsv");
    ledger
        .lines()
        .skip(1)
        .map(|line| line.split('\t').collect::<Vec<_>>())
        .filter(|cells| cells.get(2) == Some(&"replaced"))
        .filter_map(|cells| {
            Some(Replaced {
                file: (*cells.first()?).to_owned(),
                pointer: (*cells.get(1)?).to_owned(),
                imported: serde_json::from_str(cells.get(5)?).ok()?,
                v3: serde_json::from_str(cells.get(6)?).ok()?,
            })
        })
        .collect()
}

fn imported_cases() -> Vec<(String, Value)> {
    let manifest = std::fs::read_to_string(repo_path(
        "crates/omo-computer-core/parity/ORACLE-PROVENANCE.tsv",
    ))
    .expect("ORACLE-PROVENANCE.tsv");
    manifest
        .lines()
        .skip(1)
        .filter_map(|line| line.split('\t').next())
        .filter(|path| path.ends_with(".json"))
        .filter_map(|path| {
            let text = std::fs::read_to_string(repo_path(path)).ok()?;
            let case: Value = serde_json::from_str(&text).ok()?;
            case["steps"].is_array().then(|| (path.to_owned(), case))
        })
        .collect()
}

/// `(pointer inside the message, member, value)` for every ActionReport / Disposition member.
fn report_members(method: Option<Method>, message: &Value) -> Vec<(String, String, Value)> {
    let mut found = Vec::new();
    if method.and_then(VerbClass::of).is_some() {
        if let Some(result) = message["result"].as_object() {
            for (member, value) in result {
                found.push((format!("/result/{member}"), member.clone(), value.clone()));
            }
        }
    }
    if let Some(disposition) = message["error"]["data"].get("disposition") {
        found.push((
            "/error/data/disposition".to_owned(),
            "disposition".to_owned(),
            disposition.clone(),
        ));
    }
    found
}

#[test]
fn imported_action_report_values_are_all_inside_the_contract_types_or_carry_a_replaced_line() {
    let replaced = replaced_lines();
    let (mut compared, mut via_ledger, mut problems) = (0, 0, Vec::new());
    for (file, case) in imported_cases() {
        let oneshot = case["transport"].as_str() == Some("oneshot");
        for step in case["steps"].as_array().into_iter().flatten() {
            let name = step["send"]["method"].as_str().unwrap_or_default();
            let method = if oneshot {
                Method::from_oneshot(name)
            } else {
                Method::from_name(name)
            };
            for expect in step["expect"].as_array().into_iter().flatten() {
                for (pointer, member, value) in report_members(method, &expect["message"]) {
                    compared += 1;
                    let verdict = match member_fits(&member, &value) {
                        Some(true) => "inside the contract type".to_owned(),
                        fits => {
                            let line = replaced.iter().find(|line| {
                                line.file == file
                                    && pointer.ends_with(&line.pointer)
                                    && line.imported == value
                            });
                            match line {
                                Some(line) if member_fits(&member, &line.v3) == Some(true) => {
                                    via_ledger += 1;
                                    format!("replaced by {} (ORACLE-DELTAS)", line.v3)
                                }
                                _ => {
                                    let why = if fits.is_none() {
                                        "not a member of ActionReport"
                                    } else {
                                        "outside the contract type"
                                    };
                                    problems.push(format!(
                                        "{file} {pointer} = {value}: {why}, no replaced line"
                                    ));
                                    format!("{why}: NO LINE")
                                }
                            }
                        }
                    };
                    println!("{file}\t{pointer}\t{value}\t{verdict}");
                }
            }
        }
    }
    println!("{compared} imported values compared, {via_ledger} through a replaced line");
    assert!(compared >= 5, "the walk compared too little: {compared}");
    assert!(via_ledger >= 1, "the walk never reached the replaced line");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}
