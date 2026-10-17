//! The UI Automation action vocabulary: the names `perform` accepts and the
//! names advertised from the control patterns an element supports. Pure, so
//! it is tested without a desktop.

use senpi_desktop_core::error::{CoreResult, DesktopError};

/// One action `perform` can run, each backed by a UIA control pattern.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UiaAction {
    /// Invoke, else Toggle, else `LegacyIAccessible` `DoDefaultAction`.
    Press,
    Invoke,
    Toggle,
    Expand,
    Collapse,
    Select,
    ScrollIntoView,
}

impl UiaAction {
    /// Parses a case-insensitive action name.
    ///
    /// # Errors
    /// `AxFailed` naming `action` when no UIA pattern backs it.
    pub(crate) fn parse(action: &str) -> CoreResult<Self> {
        match action.trim().to_ascii_lowercase().as_str() {
            "press" => Ok(Self::Press),
            "invoke" => Ok(Self::Invoke),
            "toggle" => Ok(Self::Toggle),
            "expand" => Ok(Self::Expand),
            "collapse" => Ok(Self::Collapse),
            "select" => Ok(Self::Select),
            "scrollintoview" => Ok(Self::ScrollIntoView),
            _ => Err(DesktopError::ax_failed(format!(
                "unsupported UI Automation action '{action}'"
            ))),
        }
    }
}

/// The control patterns an element answered for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SupportedPatterns {
    pub(crate) invoke: bool,
    pub(crate) toggle: bool,
    pub(crate) legacy_accessible: bool,
    pub(crate) expand_collapse: bool,
    pub(crate) selection_item: bool,
    pub(crate) scroll_item: bool,
}

impl SupportedPatterns {
    /// The advertised action names, in oh-my-pi's order: `press` whenever any
    /// link of the press chain is available.
    pub(crate) fn action_names(self) -> Vec<String> {
        let mut names = Vec::with_capacity(8);
        if self.invoke || self.toggle || self.legacy_accessible {
            names.push("press");
        }
        if self.invoke {
            names.push("invoke");
        }
        if self.toggle {
            names.push("toggle");
        }
        if self.expand_collapse {
            names.extend(["expand", "collapse"]);
        }
        if self.selection_item {
            names.push("select");
        }
        if self.scroll_item {
            names.push("scrollintoview");
        }
        names.into_iter().map(str::to_string).collect()
    }
}

#[cfg(test)]
mod tests {
    use senpi_desktop_core::error::ErrorCode;

    use super::{SupportedPatterns, UiaAction};

    #[test]
    fn action_names_parse_case_insensitively() {
        for (name, action) in [
            ("press", UiaAction::Press),
            (" Invoke ", UiaAction::Invoke),
            ("TOGGLE", UiaAction::Toggle),
            ("expand", UiaAction::Expand),
            ("collapse", UiaAction::Collapse),
            ("select", UiaAction::Select),
            ("ScrollIntoView", UiaAction::ScrollIntoView),
        ] {
            assert_eq!(UiaAction::parse(name).unwrap(), action, "{name}");
        }
    }

    #[test]
    fn unknown_action_is_ax_failed_naming_it() {
        let error = UiaAction::parse("nonexistent-action").unwrap_err();
        assert_eq!(error.code, ErrorCode::AxFailed);
        assert!(
            error.message.contains("'nonexistent-action'"),
            "{}",
            error.message
        );
    }

    #[test]
    fn legacy_accessible_alone_advertises_press_only() {
        let supported = SupportedPatterns {
            legacy_accessible: true,
            ..SupportedPatterns::default()
        };
        assert_eq!(supported.action_names(), ["press"]);
    }

    #[test]
    fn every_pattern_advertises_every_action_in_order() {
        let supported = SupportedPatterns {
            invoke: true,
            toggle: true,
            legacy_accessible: true,
            expand_collapse: true,
            selection_item: true,
            scroll_item: true,
        };
        assert_eq!(
            supported.action_names(),
            [
                "press",
                "invoke",
                "toggle",
                "expand",
                "collapse",
                "select",
                "scrollintoview"
            ]
        );
    }

    #[test]
    fn element_without_patterns_advertises_nothing() {
        assert!(SupportedPatterns::default().action_names().is_empty());
    }
}
