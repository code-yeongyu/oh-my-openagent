//! The clipboard as row 24 uses it (design row C10, `design/d-sdk-skill.md` `paste`): a read
//! that may be concealed by a password manager, and the paste plan that reads the prior
//! clipboard ONLY to restore it. A concealed prior clipboard is never read; its restore is
//! skipped and the report says so. Clipboard contents never enter the audit.

/// What a clipboard read found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardRead {
    /// The text it holds; `None` when it holds no text.
    Text(Option<String>),
    /// A concealment marker is set (a password manager's item): the contents are not read.
    Concealed,
}

/// The restore half of a paste, decided from the prior clipboard before the write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Restore {
    /// Put this text back (or clear it) after the paste.
    Put(Option<String>),
    /// The prior clipboard was concealed: nothing is restored (`clipboardRestored:false,
    /// reason:"concealed"`).
    SkippedConcealed,
}

impl Restore {
    #[must_use]
    pub fn of(prior: ClipboardRead) -> Self {
        match prior {
            ClipboardRead::Text(text) => Self::Put(text),
            ClipboardRead::Concealed => Self::SkippedConcealed,
        }
    }

    /// The report's `clipboardRestored` and its reason.
    #[must_use]
    pub const fn reported(&self) -> (bool, Option<&'static str>) {
        match self {
            Self::Put(_) => (true, None),
            Self::SkippedConcealed => (false, Some("concealed")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_concealed_prior_clipboard_is_never_restored_and_says_why() {
        assert_eq!(Restore::of(ClipboardRead::Concealed), Restore::SkippedConcealed);
        assert_eq!(Restore::SkippedConcealed.reported(), (false, Some("concealed")));
        let prior = Restore::of(ClipboardRead::Text(Some("before".into())));
        assert_eq!(prior, Restore::Put(Some("before".into())));
        assert_eq!(prior.reported(), (true, None));
    }
}
