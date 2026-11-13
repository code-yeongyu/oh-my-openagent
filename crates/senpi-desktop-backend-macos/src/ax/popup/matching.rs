//! Which popup option a requested value names, and the refusal text when it
//! names none.

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Refusal {
    Missing,
    Ambiguous,
}

/// The index of the option titled exactly `requested`. Matching is exact:
/// options are the app's own strings, the refusal lists them, and two titles
/// differing only in case or spacing are distinct options. Untitled items are
/// menu separators, not options.
pub(super) fn choose_option(titles: &[String], requested: &str) -> Result<usize, Refusal> {
    let mut matches = titles
        .iter()
        .enumerate()
        .filter(|(_, title)| !title.is_empty() && *title == requested)
        .map(|(index, _)| index);
    match (matches.next(), matches.next()) {
        (Some(index), None) => Ok(index),
        (Some(_), Some(_)) => Err(Refusal::Ambiguous),
        (None, _) => Err(Refusal::Missing),
    }
}

pub(super) fn refusal_message(refusal: &Refusal, requested: &str, titles: &[String]) -> String {
    let options = option_list(titles);
    match refusal {
        Refusal::Missing => {
            format!("no popup option is titled exactly \"{requested}\"; nothing was selected. Options: {options}")
        }
        Refusal::Ambiguous => format!(
            "several popup options are titled \"{requested}\", so the value cannot say which; \
             nothing was selected. Options: {options}"
        ),
    }
}

pub(super) fn option_list(titles: &[String]) -> String {
    titles
        .iter()
        .filter(|title| !title.is_empty())
        .map(|title| format!("\"{title}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
#[path = "matching_tests.rs"]
mod tests;
