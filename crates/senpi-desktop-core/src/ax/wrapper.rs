//! The web-wrapper rule: Chromium, Electron and WebView trees nest controls
//! under chains of anonymous containers. Such a container consumes raw walk
//! depth but no logical depth, so `maxDepth` and `skeleton` count the levels
//! a reader can name.

use super::AxProps;
use crate::types::{AxEvidence, EvidenceState};

/// Raw levels an object-mode walk may descend past its logical depth limit
/// through wrappers before it cuts like any other depth limit.
pub(super) const WRAPPER_RAW_ALLOWANCE: u32 = 64;

fn blank(field: Option<&str>) -> bool {
    field.is_none_or(|text| text.trim().is_empty())
}

/// `AXScrollToVisible` (macOS), `ScrollIntoView` (UIA) and their spellings.
pub(super) fn scroll_into_view(action: &str) -> bool {
    let name: String = action
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let name = name.strip_prefix("ax").unwrap_or(&name);
    matches!(name, "scrolltovisible" | "scrollintoview")
}

/// A container with no title, value, description or identifier whose only
/// action, if any, scrolls it into view. A name the read could not see
/// (`unknown` evidence) is not proof of absence. `identifier` is read only
/// for nodes that pass every other test.
pub(super) fn is_wrapper(
    props: &AxProps,
    evidence: Option<&AxEvidence>,
    identifier: impl FnOnce() -> Option<String>,
) -> bool {
    let unread = evidence.is_some_and(|evidence| {
        [evidence.title, evidence.value, evidence.description].contains(&EvidenceState::Unknown)
    });
    !unread
        && props.child_count > 0
        && blank(props.title.as_deref())
        && blank(props.value.as_deref())
        && blank(props.description.as_deref())
        && props.actions.iter().all(|action| scroll_into_view(action))
        && blank(identifier().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn container() -> AxProps {
        AxProps {
            role: "group".into(),
            native_role: "AXGroup".into(),
            title: None,
            value: None,
            description: None,
            enabled: true,
            focused: false,
            bounds: None,
            actions: Vec::new(),
            child_count: 1,
        }
    }

    #[test]
    fn anonymous_containers_whose_only_action_scrolls_are_wrappers() {
        // Given
        let mut scrolls = container();
        scrolls.actions = vec!["AXScrollToVisible".into(), "scroll-into-view".into(), "ScrollIntoView".into()];
        // When / Then
        assert!(is_wrapper(&container(), None, || None));
        assert!(is_wrapper(&scrolls, None, || Some("  ".into())));
    }

    #[test]
    fn a_name_an_identifier_a_real_action_or_no_children_keep_logical_depth() {
        // Given
        let mut titled = container();
        titled.title = Some("Main".into());
        let mut valued = container();
        valued.value = Some("3".into());
        let mut described = container();
        described.description = Some("Toolbar".into());
        let mut pressable = container();
        pressable.actions = vec!["AXPress".into()];
        let mut leaf = container();
        leaf.child_count = 0;
        // When / Then
        for props in [titled, valued, described, pressable, leaf] {
            assert!(!is_wrapper(&props, None, || None), "{props:?}");
        }
        assert!(!is_wrapper(&container(), None, || Some("sidebar".into())));
        let unread = AxEvidence {
            title: EvidenceState::Unknown,
            value: EvidenceState::Absent,
            description: EvidenceState::Absent,
            enabled: EvidenceState::Known,
            focused: EvidenceState::Known,
            bounds: EvidenceState::Absent,
        };
        assert!(!is_wrapper(&container(), Some(&unread), || None));
    }
}
