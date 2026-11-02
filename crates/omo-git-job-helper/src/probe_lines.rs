//! Probe input lines (design v4.2 section 6.2): `entry <helper pid> <helper creation FILETIME> <op id>` per
//! operation, and an optional `gate <path>`. Every other non-empty line is a malformed entry, so output indices
//! always match input entries. Portable and unit-tested on every host.

use crate::cli::OpId;

#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    Entry { pid: u32, created: u64, op: OpId },
    Malformed,
    Gate(String),
}

pub fn parse(line: &str) -> Option<Line> {
    let line = line.trim_end_matches('\r');
    if line.trim().is_empty() {
        return None;
    }
    if let Some(path) = line.strip_prefix("gate ") {
        return Some(Line::Gate(path.to_owned()));
    }
    let fields: Vec<&str> = line.split(' ').collect();
    let entry = match fields.as_slice() {
        ["entry", pid, created, op] => pid
            .parse()
            .ok()
            .zip(created.parse().ok())
            .zip(OpId::parse(op)),
        _ => None,
    };
    Some(
        entry.map_or(Line::Malformed, |((pid, created), op)| Line::Entry {
            pid,
            created,
            op,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_gates_and_malformed_lines() {
        let op = OpId::parse("op-1").expect("valid id");
        assert_eq!(
            parse("entry 12 34 op-1\r"),
            Some(Line::Entry {
                pid: 12,
                created: 34,
                op
            })
        );
        assert_eq!(
            parse("gate C:\\x y\\g"),
            Some(Line::Gate("C:\\x y\\g".into()))
        );
        assert_eq!(parse("   "), None);
        for bad in ["entry x y z", "entry 1 2 a/b", "entry 1 2", "nonsense"] {
            assert_eq!(parse(bad), Some(Line::Malformed), "{bad}");
        }
    }
}
