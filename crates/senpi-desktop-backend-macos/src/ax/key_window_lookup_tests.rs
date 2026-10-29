//! Accessibility window lookup must find the process drawing omitted sheets.

use super::{content_owner, find_window_in, target_window, WindowContent};

#[test]
fn remote_content_is_found_for_the_whole_attached_window_class() {
    struct Case {
        name: &'static str,
        focused: Option<u32>,
        windows: Option<&'static [u32]>,
        attached: &'static [(u32, &'static str, u32)],
        found: bool,
    }
    let cases = [
        Case {
            name: "listed panel behind another focused window",
            focused: Some(543),
            windows: Some(&[543, 561]),
            attached: &[],
            found: true,
        },
        Case {
            name: "focused Save sheet omitted from AXWindows",
            focused: Some(561),
            windows: Some(&[543]),
            attached: &[],
            found: true,
        },
        Case {
            name: "focused sheet with unreadable AXWindows",
            focused: Some(561),
            windows: None,
            attached: &[],
            found: true,
        },
        Case {
            name: "unfocused attached Save sheet",
            focused: Some(543),
            windows: Some(&[543]),
            attached: &[(543, "AXSheets", 561)],
            found: true,
        },
        Case {
            name: "unfocused attached popover",
            focused: Some(543),
            windows: Some(&[543]),
            attached: &[(543, "AXPopovers", 561)],
            found: true,
        },
        Case {
            name: "Go to Folder sheet nested in an attached Open panel",
            focused: Some(543),
            windows: Some(&[543]),
            attached: &[(543, "AXSheets", 554), (554, "AXSheets", 561)],
            found: true,
        },
        Case {
            name: "sheet nested in a popover",
            focused: None,
            windows: Some(&[543]),
            attached: &[(543, "AXPopovers", 554), (554, "AXSheets", 561)],
            found: true,
        },
        Case {
            name: "popover nested in a sheet",
            focused: None,
            windows: Some(&[543]),
            attached: &[(543, "AXSheets", 554), (554, "AXPopovers", 561)],
            found: true,
        },
        Case {
            name: "mixed attachments at the fourth level",
            focused: Some(543),
            windows: Some(&[543]),
            attached: &[
                (543, "AXSheets", 1),
                (1, "AXPopovers", 2),
                (2, "AXSheets", 3),
                (3, "AXPopovers", 561),
            ],
            found: true,
        },
        Case {
            name: "fifth level remains outside the bounded search",
            focused: Some(543),
            windows: Some(&[543]),
            attached: &[
                (543, "AXSheets", 1),
                (1, "AXPopovers", 2),
                (2, "AXSheets", 3),
                (3, "AXPopovers", 4),
                (4, "AXSheets", 561),
            ],
            found: false,
        },
        Case {
            name: "unreadable parent window id still permits attached lookup",
            focused: None,
            windows: Some(&[0]),
            attached: &[(0, "AXSheets", 561)],
            found: true,
        },
        Case {
            name: "a cyclic attachment graph terminates without a target",
            focused: None,
            windows: Some(&[543]),
            attached: &[(543, "AXSheets", 543)],
            found: false,
        },
        Case {
            name: "a missing target is not the unrelated focused window",
            focused: Some(543),
            windows: Some(&[543]),
            attached: &[],
            found: false,
        },
    ];
    let mut failures = Vec::new();
    for case in cases {
        let window = target_window(
            561,
            case.focused,
            |&id| (id != 0).then_some(id),
            || {
                find_window_in(
                    561,
                    case.windows?.to_vec(),
                    |&id| (id != 0).then_some(id),
                    |&parent, attribute| {
                        Some(
                            case.attached
                                .iter()
                                .filter(|&&(owner, kind, _)| owner == parent && kind == attribute)
                                .map(|&(_, _, child)| child)
                                .collect(),
                        )
                    },
                )
            },
        );
        // As in window_content, a failed lookup reports Own; a found remote
        // sheet must instead select the process that actually draws its field.
        let content = window.map_or(WindowContent::Own, |wid| {
            content_owner(7581, wid, [Some(559)], |id| (id == 559).then_some(7592))
        });
        let expected = if case.found {
            WindowContent::Remote {
                pid: 7592,
                window: 559,
            }
        } else {
            WindowContent::Own
        };
        if content != expected {
            failures.push((case.name, content, expected));
        }
    }
    assert!(
        failures.is_empty(),
        "wrong content owner after target lookup: {failures:?}"
    );
}
