//! `ensure_pattern_safe` (d-windows.md '## Accessibility'): XAML hosts, Chromium and WPF call
//! `SetForegroundWindow(self)` from their patterns, so a UIA action on one of them off the foreground
//! is refused `BackgroundUnavailable{provider_self_activates}` before any call. Chromium is also
//! excluded from `invoke_at_point`: its `Invoke` reports success without acting. The host lists
//! ship as data (`self-activating-hosts.tsv`), not code.

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};

/// The provider family behind a top-level window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Host {
    Xaml,
    Chromium,
    Wpf,
    Other,
}

const HOSTS: &str = include_str!("self-activating-hosts.tsv");

/// The host of a top-level window with class `class`, run by `exe`.
#[must_use]
pub fn host_of(class: &str, _exe: &str) -> Host {
    for line in HOSTS.lines().skip(1) {
        let mut cells = line.split('\t');
        let (Some(kind), Some(rule)) = (cells.next(), cells.next()) else {
            continue;
        };
        let hit = match rule.split_once('=') {
            Some(("class", value)) => class == value,
            Some(("class-prefix", value)) => class.starts_with(value),
            _ => false,
        };
        if hit {
            return match kind {
                "xaml" => Host::Xaml,
                "chromium" => Host::Chromium,
                "wpf" => Host::Wpf,
                _ => Host::Other,
            };
        }
    }
    Host::Other
}

/// The refusal of a pattern call that would bring its provider to the foreground.
pub const PROVIDER_SELF_ACTIVATES: Refusal = Refusal::new(
    EngineCode::BackgroundUnavailable,
    Reason::ProviderSelfActivates.wire(),
);

/// Admits a UIA pattern call on `host`.
///
/// # Errors
/// [`PROVIDER_SELF_ACTIVATES`] for a self-activating host that is not the foreground.
pub const fn ensure_pattern_safe(host: Host, foreground: bool) -> Result<(), Refusal> {
    match host {
        Host::Xaml | Host::Chromium | Host::Wpf if !foreground => Err(PROVIDER_SELF_ACTIVATES),
        _ => Ok(()),
    }
}

/// Whether `invoke_at_point` may be used on `host`.
#[must_use]
pub const fn invoke_at_point_allowed(host: Host) -> bool {
    !matches!(host, Host::Chromium)
}
