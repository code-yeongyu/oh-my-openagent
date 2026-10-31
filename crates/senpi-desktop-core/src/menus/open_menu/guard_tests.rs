use super::{guard, MenuWindow, Press, Settled};
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
fn a_press_whose_menu_was_closed_reports_delivery_and_the_items() {
    let closed = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| {
        Ok(Settled::Unchosen {
            refusal: None,
            items: "\"New Folder\"".to_string(),
            closed: true,
        })
    };
    // The page's handlers already ran, and a drag ran its whole stroke, so
    // the caller must inspect rather than take the error for "nothing sent".
    for kind in ["click", "drag"] {
        let press = Press::Pointer {
            kind,
            id: "42",
            app: "Finder",
        };
        let error = guard(&mut (), press, Some(&[]), None, delivered, closed).expect_err("closed");
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
    let error = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        None,
        delivered,
        closed,
    )
    .expect_err("closed");
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error
            .message
            .starts_with("AXPress opened a menu, which takes the keyboard from the user's app"),
        "{}",
        error.message
    );
    assert!(error
        .message
        .contains("so it was closed with nothing chosen"));
    assert!(error.message.contains("pass its path as the menu option"));
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
        None,
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
        None,
        cancelled,
        open,
    )
    .expect_err("open");
    assert_eq!(error.code, ErrorCode::InputFailed);
    let none = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| Ok(Settled::NoMenu);
    assert!(guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        None,
        delivered,
        none
    )
    .is_ok());
}

#[test]
fn a_path_succeeds_only_when_its_item_was_chosen() {
    let wanted = path(&["Add to", "Bench Holdout"]);
    let chosen = |_: &mut Nothing, _: &[MenuWindow], path: Option<&[String]>| {
        assert_eq!(path, Some(wanted.as_slice()));
        Ok(Settled::Chosen)
    };
    assert!(guard(&mut (), FINDER, Some(&[]), Some(&wanted), delivered, chosen).is_ok());
    // No menu to choose from fails as delivered.
    let none = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| Ok(Settled::NoMenu);
    let error =
        guard(&mut (), FINDER, Some(&[]), Some(&wanted), delivered, none).expect_err("no menu");
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
        Some(&wanted),
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
        Some(&wanted),
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

#[test]
fn settling_errors_end_the_call_only_when_they_stop_it() {
    // No snapshot from before: no menu handling at all.
    let unread = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| -> CoreResult<Settled> {
        panic!("no menu handling")
    };
    assert!(guard(
        &mut (),
        Press::Action("AXPress"),
        None,
        None,
        delivered,
        unread
    )
    .is_ok());
    // The user came to the target before the item was pressed: the menu was
    // closed, and the call says why rather than a failed restoration.
    let intervened = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[MenuWindow(5)]),
        Some(&path(&["Show in Finder"])),
        delivered,
        |_, _, _| {
            Err(DesktopError::user_intervened(
                "the user clicked in window 42",
            ))
        },
    );
    assert_eq!(
        intervened.expect_err("refused").code,
        ErrorCode::UserIntervened
    );
    let unreadable = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        None,
        delivered,
        |_, _, _| Err(DesktopError::input_failed("unread")),
    );
    assert_eq!(unreadable.expect_err("unread").code, ErrorCode::InputFailed);
    // A press that failed is what the call reports, not the settling error.
    let both = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        None,
        |_| Err(DesktopError::ax_failed("press failed")),
        |_, _, _| Err(DesktopError::input_failed("unread")),
    );
    assert_eq!(both.expect_err("failed").message, "press failed");
}
