//! Searches over the whole observed snapshot: the `query` projection (matches, every ancestor,
//! at most 8 descendant lines per match; the whole phrase first, then any word of 3 or more
//! characters) and `find` by role and text.

use std::collections::BTreeSet;

use omo_computer_core::ax::{line, LineStyle};
use omo_computer_core::listing::ElementInfo;
use omo_computer_core::observation::Cut;

use crate::diff::{Outline, OutlineLine};
use crate::refs::{Generation, RefEntry};

/// Descendant lines a query shows under each match.
const DESCENDANTS_PER_MATCH: usize = 8;

/// What `find` looks for; an absent member matches everything.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Criteria {
    pub role: Option<String>,
    pub text: Option<String>,
}

fn searchable(entry: &RefEntry) -> String {
    let read = &entry.read;
    let value = if read.secure { None } else { read.value.as_deref() };
    [Some(read.role.as_str()), read.title.as_deref(), read.description.as_deref(), value]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn matches(generation: &Generation, phrase: &str) -> Vec<usize> {
    let phrase = phrase.trim().to_lowercase();
    let texts: Vec<String> = generation.entries.iter().map(searchable).collect();
    let whole: Vec<usize> = (0..texts.len()).filter(|i| texts[*i].contains(&phrase)).collect();
    if !whole.is_empty() {
        return whole;
    }
    let words: Vec<&str> = phrase.split_whitespace().filter(|word| word.chars().count() >= 3).collect();
    (0..texts.len()).filter(|i| words.iter().any(|word| texts[*i].contains(word))).collect()
}

/// The `query` projection of `generation`.
#[must_use]
pub fn project(generation: &Generation, phrase: &str, nodes_observed: u32) -> (Outline, Vec<Cut>) {
    let entries = &generation.entries;
    let mut shown: BTreeSet<usize> = BTreeSet::new();
    for hit in matches(generation, phrase) {
        let mut at = Some(hit);
        while let Some(index) = at {
            shown.insert(index);
            at = entries[index].parent;
        }
        let below = entries[hit + 1..].iter().take_while(|entry| entry.depth > entries[hit].depth).count();
        shown.extend((hit + 1..=hit + below).take(DESCENDANTS_PER_MATCH));
    }
    let mut lines = Vec::new();
    let mut cuts = Vec::new();
    for index in shown {
        let entry = &entries[index];
        let indent = usize::try_from(entry.depth).unwrap_or(usize::MAX);
        let token = generation.token(index);
        let style = LineStyle { actions: false, value: true };
        if let Some(child_count) = entry.left_out {
            cuts.push(Cut { reference: token.clone(), child_count });
        }
        let parent = entry.parent.map(|parent| entries[parent].n);
        let key = line(&entry.read, &format!("e{}", entry.n), "", style, entry.left_out);
        let text = format!("{}{}", "  ".repeat(indent), line(&entry.read, &token, "", style, entry.left_out));
        lines.push(OutlineLine { n: entry.n, parent, indent, key, text });
    }
    let completeness = if generation.complete { "complete" } else { "partial" };
    let trailer = format!("… {nodes_observed} nodes observed, {} shown (query {phrase:?}); {completeness}", lines.len());
    (Outline { lines, trailer }, cuts)
}

/// `find` over `generation`: role equal (any case), text inside the title, description or
/// value.
#[must_use]
pub fn find(generation: &Generation, criteria: &Criteria) -> Vec<ElementInfo> {
    let text = criteria.text.as_deref().map(str::to_lowercase);
    (0..generation.entries.len())
        .filter(|index| {
            let entry = &generation.entries[*index];
            let role_ok = criteria.role.as_deref().is_none_or(|role| entry.read.role.eq_ignore_ascii_case(role));
            let text_ok = text.as_deref().is_none_or(|text| searchable(entry).contains(text));
            role_ok && text_ok
        })
        .map(|index| generation.element_info(index))
        .collect()
}
