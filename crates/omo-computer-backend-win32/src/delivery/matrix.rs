//! The drop matrix as DATA (`matrix.tsv`): one row per family and window-class pattern, the
//! background verbs that family drops, the only next delivery after the refusal, and what the row
//! rests on - a row of the spike's probe ledger (`win32-delivery:<id>`), or, for a refusal the
//! spike did not measure, the design's harvest id (`design:<id>`). A row that DELIVERS always cites
//! the ledger; a refusal never needs a measurement to be safe (`delivery/tests/matrix.rs`).
//!
//! A class pattern is an exact window class, or a prefix ending in `*` that needs a non-empty
//! rest, so a lookalike (`ChromeLikeWidgetWin`) is never a member. Family `unknown` with class `*`
//! is the catch-all after every named row: a class the spike measured no cell for refuses every
//! background verb. Family `*` with class `*` is a per-ROUTE row every family drops
//! (`chord_modifier`).

use std::sync::OnceLock;

use super::family::{Family, Verb};

const TSV: &str = include_str!("matrix.tsv");

/// One parsed row.
#[derive(Debug)]
pub struct Row {
    /// `None` for a per-route row (every family).
    pub family: Option<Family>,
    pub pattern: &'static str,
    pub refused: Vec<Verb>,
    pub cite: &'static str,
}

impl Row {
    /// Whether `class` is a member of this row.
    #[must_use]
    pub fn matches(&self, class: &str) -> bool {
        match self.pattern.strip_suffix('*') {
            Some(prefix) => class
                .strip_prefix(prefix)
                .is_some_and(|rest| !rest.is_empty()),
            None => class == self.pattern,
        }
    }
}

/// Why `matrix.tsv` failed to parse.
#[derive(Debug, PartialEq, Eq)]
pub struct BadRow(pub &'static str);

fn row(line: &'static str) -> Result<Row, BadRow> {
    let bad = || BadRow(line);
    let mut columns = line.split('\t');
    let mut next = || columns.next().ok_or_else(bad);
    let (family, pattern, verbs, _next, cite) = (next()?, next()?, next()?, next()?, next()?);
    let family = match family {
        "*" => None,
        wire => Some(Family::from_wire(wire).ok_or_else(bad)?),
    };
    let refused = match verbs {
        "-" => Vec::new(),
        list => list
            .split(',')
            .map(|verb| Verb::from_wire(verb).ok_or_else(bad))
            .collect::<Result<_, _>>()?,
    };
    Ok(Row {
        family,
        pattern,
        refused,
        cite,
    })
}

/// Every row of `matrix.tsv`, header skipped.
///
/// # Errors
/// The first line that is not a row.
pub fn parse() -> Result<Vec<Row>, BadRow> {
    TSV.lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .map(row)
        .collect()
}

/// The matrix, parsed once; `None` when the compiled-in table does not parse, and then every
/// background verb is refused (fail closed). `matrix_rows_parse` proves the table parses.
#[must_use]
pub fn rows() -> Option<&'static [Row]> {
    static ROWS: OnceLock<Option<Vec<Row>>> = OnceLock::new();
    ROWS.get_or_init(|| parse().ok()).as_deref()
}
