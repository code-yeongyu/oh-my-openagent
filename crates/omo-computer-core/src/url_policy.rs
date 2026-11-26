//! `computer.url_policy` (acceptance 94; design row C24, `design/d-safety.md` '### Browser windows
//! driven by computer use'): a per-hand denied-host table, EMPTY by default. Before an exec into a
//! browser-class window the Consequential stage reads the focused web area's URL and matches its
//! host against the globs: a match refuses `ControlRequired{url_policy, host, app}` with nothing
//! sent; an unreadable URL DELIVERS and stamps `urlPolicy:"unknown"` (fail-open, so a deny list
//! that cannot read the address bar never refuses every click); an empty table skips the read.

/// The `urlPolicy` member of an `ActionReport`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum UrlPolicyStamp {
    Unknown,
}

/// The verdict of one exec into a window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UrlVerdict {
    /// The table is empty: nothing was read.
    Skipped,
    Allowed,
    Denied { host: String },
    /// The URL could not be read: deliver, stamp `urlPolicy:"unknown"`.
    Unknown,
}

/// The denied-host globs of one hand.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UrlPolicy {
    denied: Vec<String>,
}

impl UrlPolicy {
    #[must_use]
    pub fn new(denied: Vec<String>) -> Self {
        Self { denied }
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.denied.is_empty()
    }

    /// Checks one exec; `read` is called only when the table is non-empty.
    pub fn check(&self, read: impl FnOnce() -> Option<String>) -> UrlVerdict {
        if self.is_empty() {
            return UrlVerdict::Skipped;
        }
        let Some(host) = read().as_deref().and_then(host_of) else {
            return UrlVerdict::Unknown;
        };
        if self.denied.iter().any(|glob| glob_matches(glob, &host)) {
            UrlVerdict::Denied { host }
        } else {
            UrlVerdict::Allowed
        }
    }
}

/// The lower-cased host of an absolute URL (`scheme://[user@]host[:port]/...`).
#[must_use]
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let host = host.split(':').next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// A host glob: `*` matches any run of characters, compared case-insensitively.
#[must_use]
pub fn glob_matches(glob: &str, host: &str) -> bool {
    fn go(pattern: &[u8], text: &[u8]) -> bool {
        match pattern.split_first() {
            None => text.is_empty(),
            Some((b'*', rest)) => (0..=text.len()).any(|skip| go(rest, &text[skip..])),
            Some((c, rest)) => text.split_first().is_some_and(|(t, tail)| t == c && go(rest, tail)),
        }
    }
    go(glob.to_ascii_lowercase().as_bytes(), host.to_ascii_lowercase().as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_policy_denied_host_refuses_before_send_by_glob() {
        let policy = UrlPolicy::new(vec!["*.bank.example".to_owned()]);
        assert_eq!(
            policy.check(|| Some("https://pay.bank.example/x".to_owned())),
            UrlVerdict::Denied { host: "pay.bank.example".to_owned() }
        );
        assert_eq!(policy.check(|| Some("https://docs.example".to_owned())), UrlVerdict::Allowed);
        assert_eq!(policy.check(|| Some("https://u@PAY.Bank.Example:8443/".to_owned())),
            UrlVerdict::Denied { host: "pay.bank.example".to_owned() });
        assert_eq!(policy.check(|| None), UrlVerdict::Unknown);
        assert_eq!(policy.check(|| Some("not a url".to_owned())), UrlVerdict::Unknown);
    }

    #[test]
    fn an_empty_table_never_reads_and_never_refuses() {
        let read = std::cell::Cell::new(0);
        let verdict = UrlPolicy::default().check(|| {
            read.set(read.get() + 1);
            Some("https://pay.bank.example/".to_owned())
        });
        assert_eq!((verdict, read.get()), (UrlVerdict::Skipped, 0));
    }
}
