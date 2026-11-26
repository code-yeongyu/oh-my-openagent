//! Denial memory and the per-app stop (acceptance 71, 72; ASB-13/31 shape). Both live until a
//! newer user message, both are per hand (one `Consent` per hand), and both key an app by its
//! identity, so a stop recorded for one cdhash does not cover another copy.

use std::collections::BTreeSet;

/// The consent part a prompt asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Part {
    Tier,
    Foreground,
    AppScope,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Memory {
    denied: BTreeSet<(Part, String)>,
    stopped: BTreeSet<String>,
}

impl Memory {
    /// The host's prompt for `part` (on `subject`, an app's memory key or `""`) was denied.
    pub fn deny(&mut self, part: Part, subject: &str) {
        self.denied.insert((part, subject.to_owned()));
    }

    #[must_use]
    pub fn is_denied(&self, part: Part, subject: &str) -> bool {
        self.denied.contains(&(part, subject.to_owned()))
    }

    /// "Stop computer use in <app>" on the presence surface: that app leaves the scope.
    pub fn stop_app(&mut self, subject: &str) {
        self.stopped.insert(subject.to_owned());
    }

    #[must_use]
    pub fn is_stopped(&self, subject: &str) -> bool {
        self.stopped.contains(subject)
    }

    /// A newer user message clears both.
    pub fn user_message(&mut self) {
        self.denied.clear();
        self.stopped.clear();
    }
}
