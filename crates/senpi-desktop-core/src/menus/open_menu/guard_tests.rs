use super::{guard, MenuWindow, Press, Settled, Watch};
use crate::error::{CoreResult, DesktopError, ErrorCode};

const FINDER: Press<'static> = Press::Pointer {
    kind: "click",
    id: "42",
    app: "Finder",
};

/// The tests' backend: nothing the press or the settle needs.
type Nothing = ();

fn path(labels: &[&str]) -> Vec<String> {
    labels.iter().map(ToString::to_string).collect()
}

fn delivered(_: &mut Nothing) -> CoreResult<()> {
    Ok(())
}

#[test]
fn a_press_asked_to_choose_whose_menu_was_closed_reports_delivery_and_the_items() {
    let wanted = path(&["Sans"]);
    // The page's handlers already ran, and a drag ran its whole stroke, so
    // the caller must inspect rather than take the error for "nothing sent".
    for kind in ["click", "drag"] {
        let press = Press::Pointer {
            kind,
            id: "42",
            app: "Finder",
        };
        let error = guard(
            &mut (),
            press,
            Some(&[]),
            Watch::Choose(&wanted),
            delivered,
            |_, _, _| {
                Ok(Settled::Unchosen {
                    refusal: Some("menu item 'Sans' was not found".to_string()),
                    items: "\"New Folder\"".to_string(),
                    closed: true,
                })
            },
        )
        .expect_err("closed");
        assert_eq!(error.code, ErrorCode::InputFailed, "{kind}");
        assert!(error
            .message
            .contains(&format!("the {kind} may already have taken effect")));
        assert!(error.message.contains("inspect the window before retrying"));
        assert!(
            error.message.ends_with("Items: \"New Folder\"."),
            "{}",
            error.message
        );
    }
    // A menu still open fails whatever the press returned.
    let open = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| {
        Ok(Settled::Unchosen {
            refusal: None,
            items: String::new(),
            closed: false,
        })
    };
    let error = guard(
        &mut (),
        Press::Action("AXShowMenu"),
        Some(&[]),
        Watch::ListAndClose,
        delivered,
        open,
    )
    .expect_err("open");
    assert!(
        error.message.contains("still open after Escape"),
        "{}",
        error.message
    );
    let cancelled = |_: &mut Nothing| Err(DesktopError::new(ErrorCode::Cancelled, "cancelled"));
    let error = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        Watch::ListAndClose,
        cancelled,
        open,
    )
    .expect_err("open");
    assert_eq!(error.code, ErrorCode::InputFailed);
    let none = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| Ok(Settled::NoMenu);
    assert_eq!(
        guard(
            &mut (),
            Press::Action("AXPress"),
            Some(&[]),
            Watch::ListAndClose,
            delivered,
            none
        ),
        Ok(None)
    );
}

#[test]
fn a_path_succeeds_only_when_its_item_was_chosen() {
    let wanted = path(&["Add to", "Bench Holdout"]);
    let chosen = |_: &mut Nothing, _: &[MenuWindow], path: Option<&[String]>| {
        assert_eq!(path, Some(wanted.as_slice()));
        Ok(Settled::Chosen)
    };
    assert_eq!(
        guard(
            &mut (),
            FINDER,
            Some(&[]),
            Watch::Choose(&wanted),
            delivered,
            chosen
        ),
        Ok(None)
    );
    // No menu to choose from fails as delivered.
    let none = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| Ok(Settled::NoMenu);
    let error = guard(
        &mut (),
        FINDER,
        Some(&[]),
        Watch::Choose(&wanted),
        delivered,
        none,
    )
    .expect_err("no menu");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error
            .message
            .contains("opened no menu, so nothing was chosen"),
        "{}",
        error.message
    );
    // A refused path names why and lists the level it stopped at.
    let refused = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| {
        Ok(Settled::Unchosen {
            refusal: Some("menu item 'Sans' was not found".to_string()),
            items: "\"Bench Holdout\"".to_string(),
            closed: true,
        })
    };
    let error = guard(
        &mut (),
        FINDER,
        Some(&[]),
        Watch::Choose(&wanted),
        delivered,
        refused,
    )
    .expect_err("refused");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error
            .message
            .contains("opened a menu, but menu item 'Sans' was not found, so nothing was chosen"),
        "{}",
        error.message
    );
    assert!(
        error.message.ends_with("Items: \"Bench Holdout\"."),
        "{}",
        error.message
    );
    // A press that failed only has its menu closed, never an item chosen.
    let failed = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        Watch::Choose(&wanted),
        |_| Err(DesktopError::ax_failed("press failed")),
        |_, _, path| {
            assert_eq!(path, None);
            Ok(Settled::Unchosen {
                refusal: None,
                items: String::new(),
                closed: true,
            })
        },
    );
    assert_eq!(failed.expect_err("failed").message, "press failed");
}
