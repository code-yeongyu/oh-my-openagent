//! Mismatches another row owns (plan owner decision 5, 2026-11-16): `tests/fixtures/OWED.tsv`
//! names a case, a step and a pointer that row 28 replays but whose behaviour a lower row builds
//! (capture caps, the ax outline, intervention stages, the host-relay stop path). Such a mismatch
//! is reported as OWED instead of failing; an OWED line that no longer matches fails, so the list
//! shrinks the moment its owner lands.

use std::collections::BTreeSet;
use std::fs;

use super::case::repo;

const OWED: &str = "crates/omo-computer-engine/tests/fixtures/OWED.tsv";

fn owed_for(case: &str) -> Vec<(usize, String, String)> {
    let text = fs::read_to_string(repo().join(OWED)).expect("the owed ledger is readable");
    text.lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let cols: Vec<&str> = line.split('\t').collect();
            let [file, step, pointer, owner, source] = cols.as_slice() else {
                panic!("{OWED}: malformed line (expected case, step, pointer, owner row, source): {line}");
            };
            assert!(!owner.is_empty() && !source.is_empty(), "{OWED}: an owed line names its owner and source: {line}");
            (*file == case).then(|| (step.parse().expect("a step number"), (*pointer).to_owned(), line.to_owned()))
        })
        .collect()
}

/// `(step, pointer)` of a `MISMATCH step=<n> message=<m> <pointer>: ...` failure line.
fn located(failure: &str) -> Option<(usize, &str)> {
    let rest = failure.strip_prefix("MISMATCH step=")?;
    let (step, rest) = rest.split_once(' ')?;
    let rest = rest.strip_prefix("message=")?.split_once(' ')?.1;
    let pointer = rest.split_once(": ").map_or(rest, |(pointer, _)| pointer);
    Some((step.parse().ok()?, pointer))
}

/// Splits `failures` into the ones that still fail and the owed ones; an owed line of this case
/// that matched nothing is added as a failure (its owner landed, so the line must go).
pub fn split(case: &str, failures: Vec<String>) -> (Vec<String>, Vec<String>) {
    let owed = owed_for(case);
    let mut used = BTreeSet::new();
    let mut failing = Vec::new();
    let mut owed_failures = Vec::new();
    for failure in failures {
        let index = located(&failure)
            .and_then(|(step, pointer)| owed.iter().position(|(s, p, _)| *s == step && p == pointer));
        match index {
            Some(index) => {
                used.insert(index);
                owed_failures.push(failure);
            }
            None => failing.push(failure),
        }
    }
    for (index, (_, _, line)) in owed.iter().enumerate() {
        if !used.contains(&index) {
            failing.push(format!("STALE OWED (its owner landed; remove the line): {line}"));
        }
    }
    (failing, owed_failures)
}

#[cfg(test)]
mod tests {
    use super::located;

    #[test]
    fn a_mismatch_line_yields_its_step_and_pointer() {
        assert_eq!(located("MISMATCH step=5 message=1 /result/width: expected 640 got 800"), Some((5, "/result/width")));
        assert_eq!(located("LEFTOVER {}"), None);
    }
}
