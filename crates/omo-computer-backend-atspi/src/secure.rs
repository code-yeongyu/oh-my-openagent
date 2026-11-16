//! Private mode on Linux: a `password text` role, an unreadable role, or a label matching the
//! shipped table's `secureLabelRegex` marks an element secure (`d-linux.md` '### Tree';
//! the table is `protected-targets.linux.json`, read from the safety crate, never restated).

use std::sync::OnceLock;

use omo_computer_safety::protected::{Os, ProtectedTable};
use regex::Regex;

use crate::bus::NodeFacts;

fn label_regex() -> Option<&'static Regex> {
    static REGEX: OnceLock<Option<Regex>> = OnceLock::new();
    REGEX
        .get_or_init(|| {
            let pattern = &ProtectedTable::of(Os::Linux).secure_label_regex;
            Regex::new(&format!("(?i){pattern}")).ok()
        })
        .as_ref()
}

/// The element's contents must never leave the backend. A table regex that fails to compile
/// classifies every labelled element secure: the check fails closed.
#[must_use]
pub fn is_secure(facts: &NodeFacts) -> bool {
    if facts.role == "password text" || facts.role.is_empty() {
        return true;
    }
    let labels = [facts.name.as_deref(), facts.description.as_deref()];
    labels
        .into_iter()
        .flatten()
        .any(|label| label_regex().is_none_or(|regex| regex.is_match(label)))
}
