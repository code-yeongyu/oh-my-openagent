use super::{guard, MenuWindow, Press, Settled, Watch};
use crate::error::{CoreResult, DesktopError, ErrorCode};
use crate::protocol_results::MenuReport;

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

fn closed_unchosen(_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>) -> CoreResult<Settled> {
    Ok(Settled::Unchosen {
        refusal: None,
        items: "\"New Folder\"".to_string(),
        closed: true,
    })
}

#[test]
fn a_press_watched_without_a_path_lists_the_menu_it_closed() {
    // D1: the menu is closed with nothing chosen and the call succeeds with
    // the items, so the next call can name one with `menu:`.
    let report = guard(
        &mut (),
        FINDER,
        Some(&[]),
        Watch::ListAndClose,
        delivered,
        closed_unchosen,
    )
    .expect("listed");
    assert_eq!(
        report,
        Some(MenuReport {
            items: "\"New Folder\"".to_string()
        })
    );
    // The same press that failed after opening its menu reports its own
    // error once the menu is closed.
    let failed = guard(
        &mut (),
        FINDER,
        Some(&[]),
        Watch::ListAndClose,
        |_| Err(DesktopError::ax_failed("press failed")),
        closed_unchosen,
    );
    assert_eq!(failed.expect_err("failed").message, "press failed");
}

#[test]
fn settling_errors_end_the_call_only_when_they_stop_it() {
    let unread = |_: &mut Nothing, _: &[MenuWindow], _: Option<&[String]>| -> CoreResult<Settled> {
        panic!("no menu handling")
    };
    // No snapshot from before: no menu handling at all.
    assert_eq!(
        guard(
            &mut (),
            Press::Action("AXPress"),
            None,
            Watch::ListAndClose,
            delivered,
            unread
        ),
        Ok(None)
    );
    // A refusal before anything went out opened no menu: nothing to settle.
    let refused = |_: &mut Nothing| {
        Err(DesktopError::background_unavailable(
            "the app drops background clicks",
        ))
    };
    let error = guard(
        &mut (),
        FINDER,
        Some(&[]),
        Watch::ListAndClose,
        refused,
        unread,
    )
    .expect_err("refused");
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    // The user came to the target before the item was pressed: the menu was
    // closed, and the call says why rather than a failed restoration.
    let wanted = path(&["Show in Finder"]);
    let intervened = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[MenuWindow(5)]),
        Watch::Choose(&wanted),
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
        Watch::ListAndClose,
        delivered,
        |_, _, _| Err(DesktopError::input_failed("unread")),
    );
    assert_eq!(unreadable.expect_err("unread").code, ErrorCode::InputFailed);
    // A press that failed is what the call reports, not the settling error.
    let both = guard(
        &mut (),
        Press::Action("AXPress"),
        Some(&[]),
        Watch::ListAndClose,
        |_| Err(DesktopError::ax_failed("press failed")),
        |_, _, _| Err(DesktopError::input_failed("unread")),
    );
    assert_eq!(both.expect_err("failed").message, "press failed");
}
