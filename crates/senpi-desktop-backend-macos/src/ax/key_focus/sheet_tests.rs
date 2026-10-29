use super::*;

#[test]
fn a_focused_document_does_not_hide_its_attached_sheet() {
    let focus = KeyFocus {
        window: FocusedWindow::Id(41),
        element_window: Some(42),
        element_mapped: true,
        element_kind: ElementWindowKind::Sheet,
    };
    let parent = |id| (id == 42).then_some(41);
    assert_eq!(
        focus.destination(7, 41, parent),
        KeyDestination::Other(Some(42))
    );
    assert_eq!(focus.destination(7, 42, parent), KeyDestination::Target(7));
}

#[test]
fn known_role_and_addressed_window_matrix_preserves_popover_parent_acceptance() {
    // "None" in the role matrix means an ordinary window, not a failed probe.
    for (label, role) in [
        ("popover", "AXPopover"),
        ("sheet", "AXSheet"),
        ("none", "AXWindow"),
    ] {
        let kind = window_kind::classify(Ok(Some(role.into())), Ok(None));
        let focus = KeyFocus {
            window: FocusedWindow::Id(41),
            element_window: Some(42),
            element_mapped: true,
            element_kind: kind,
        };
        for target in [41, 42] {
            let expected = if label == "sheet" && target == 41 {
                KeyDestination::Other(Some(42))
            } else {
                KeyDestination::Target(7)
            };
            assert_eq!(
                focus.destination(7, target, |id| (id == 42).then_some(41)),
                expected,
                "{label}, target {target}",
            );
        }
    }
}

#[test]
fn subrole_sheets_and_unknown_sheet_candidates_fail_closed_without_harming_other_windows() {
    use objc2_application_services::AXError;

    let sheet = window_kind::classify(Ok(Some("AXWindow".into())), Ok(Some("AXSheet".into())));
    assert_eq!(sheet, ElementWindowKind::Sheet);
    let unknown = window_kind::classify(Ok(Some("AXWindow".into())), Err(AXError::CannotComplete));
    assert_eq!(unknown, ElementWindowKind::Unknown);
    assert_eq!(
        window_kind::classify(Ok(Some("AXPopover".into())), Err(AXError::CannotComplete)),
        ElementWindowKind::Popover,
        "a known popover is not an unknown sheet candidate",
    );
    for kind in [sheet, unknown] {
        let focus = KeyFocus {
            window: FocusedWindow::Id(41),
            element_window: Some(42),
            element_mapped: false,
            element_kind: kind,
        };
        assert_eq!(
            focus.destination(7, 41, |id| (id == 42).then_some(41)),
            KeyDestination::Other(Some(42)),
        );
        assert_eq!(
            focus.destination(7, 42, |id| (id == 42).then_some(41)),
            KeyDestination::Target(7),
        );
    }
    let focus = KeyFocus {
        window: FocusedWindow::Id(41),
        element_window: Some(42),
        element_kind: unknown,
        ..KeyFocus::default()
    };
    assert_eq!(
        focus.destination(7, 41, |_| None),
        KeyDestination::Target(7)
    );
    let rename = KeyFocus {
        window: FocusedWindow::Unreported,
        ..focus
    };
    assert_eq!(
        rename.destination(7, 41, |id| (id == 42).then_some(41)),
        KeyDestination::Target(7),
    );
}
