use std::time::Duration;

use super::fake::Fake;
use super::{
    listing, menu_process, new_menu, owns_menu, settle_with, MenuWindow, PressChecks, Settled,
    CONTEXT_MENU_TIMEOUT, MAX_LISTED_ITEMS,
};
use crate::error::{CoreResult, DesktopError, ErrorCode};

fn path(labels: &[&str]) -> Vec<String> {
    labels.iter().map(ToString::to_string).collect()
}

fn passes() -> CoreResult<()> {
    Ok(())
}

/// The agent was not stopped and the target still holds at every recheck.
const HELD: PressChecks<'static> = PressChecks {
    stop: &passes,
    holds: &passes,
};

fn settle(
    app: &mut Fake,
    wanted: Option<&[String]>,
    checks: &PressChecks<'_>,
) -> CoreResult<Settled> {
    settle_with(app, &[], wanted, CONTEXT_MENU_TIMEOUT, checks)
}

#[test]
fn a_menu_the_press_opened_is_closed_and_its_items_listed() {
    let mut app = Fake::font_book();
    let settled = settle(&mut app, None, &HELD).expect("settled");
    assert_eq!(
        settled,
        Settled::Unchosen {
            refusal: None,
            items: "\"Add to\" \u{25b8} [\"Bench Holdout\", \"Serif\u{2026}\"], \"Remove\" (disabled), \"Show in Finder\""
                .to_string(),
            closed: true,
        }
    );
    // Escape would leave the menu fading out with the keyboard.
    assert_eq!(app.logged(), ["cancel"]);
}

#[test]
fn escape_closes_a_menu_that_refuses_cancel() {
    let mut app = Fake::font_book();
    app.cancel_works = false;
    let settled = settle(&mut app, None, &HELD).expect("settled");
    assert!(
        matches!(settled, Settled::Unchosen { closed: true, .. }),
        "{settled:?}"
    );
    assert_eq!(app.logged(), ["cancel", "escape"]);
}

#[test]
fn a_path_presses_its_leaf_through_submenus_and_cancels_the_fading_menu() {
    let mut app = Fake::font_book();
    // `AppKit` flashes the pressed item and fades the menu out for about
    // 340 ms, with the user's keyboard; the cancel ends it at once.
    app.press_closes = false;
    let wanted = path(&["add TO", "serif..."]);
    let settled = settle(&mut app, Some(&wanted), &HELD);
    assert_eq!(settled.expect("settled"), Settled::Chosen);
    assert_eq!(app.logged(), ["press Serif\u{2026}", "cancel"]);
}

#[test]
fn a_path_presses_nothing_once_the_target_no_longer_holds() {
    // The user brought the target forward while its menu took its time to
    // appear: the recheck right before the press refuses, and the menu is
    // closed with nothing pressed.
    let mut app = Fake::font_book();
    let wanted = path(&["Show in Finder"]);
    let came_front = || {
        Err(DesktopError::background_unavailable(
            "window 42's application came to the front",
        ))
    };
    let checks = PressChecks {
        stop: &passes,
        holds: &came_front,
    };
    let settled = settle(&mut app, Some(&wanted), &checks);
    // The press that opened the menu went out, so this is a delivered call
    // whose path chose nothing, not a refusal before any input.
    assert_eq!(
        settled.expect("settled"),
        Settled::Unchosen {
            refusal: Some("window 42's application came to the front".to_string()),
            items: String::new(),
            closed: true,
        }
    );
    assert_eq!(app.logged(), ["cancel"]);
    assert!(app.open.is_empty());
    // A path that matches nothing refuses without the recheck.
    let mut app = Fake::font_book();
    let wanted = path(&["Sans"]);
    let unasked = || -> CoreResult<()> { panic!("nothing is pressed, so nothing is rechecked") };
    let checks = PressChecks {
        stop: &unasked,
        holds: &unasked,
    };
    let settled = settle(&mut app, Some(&wanted), &checks);
    assert!(
        matches!(settled, Ok(Settled::Unchosen { closed: true, .. })),
        "{settled:?}"
    );
}

#[test]
fn a_path_presses_nothing_once_the_call_was_stopped() {
    // The agent was stopped after the click went out and before its menu
    // appeared: the menu is closed, and its item is not pressed.
    let mut app = Fake::font_book();
    let wanted = path(&["Show in Finder"]);
    let cancelled = || {
        Err(DesktopError::new(
            ErrorCode::Cancelled,
            "the request was cancelled",
        ))
    };
    let checks = PressChecks {
        stop: &cancelled,
        holds: &passes,
    };
    let error = settle(&mut app, Some(&wanted), &checks).expect_err("cancelled");
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(app.logged(), ["cancel"]);
}

#[test]
fn a_path_presses_nothing_once_the_user_used_the_app() {
    // The user typed in the target's app while the menu its click opened took
    // its time to appear: the call stops as the user's, the menu is closed,
    // and its item is not pressed.
    fn stepped_in() -> CoreResult<()> {
        Err(DesktopError::user_intervened("the user typed in Font Book"))
    }
    let _watch = crate::intervention::watch(stepped_in);
    let mut app = Fake::font_book();
    let wanted = path(&["Show in Finder"]);
    let error = settle(&mut app, Some(&wanted), &HELD).expect_err("the user stepped in");
    assert_eq!(error.code, ErrorCode::UserIntervened);
    assert_eq!(app.logged(), ["cancel"]);
}

#[test]
fn a_path_that_chooses_nothing_closes_the_menu_and_lists_its_level() {
    let refused = |labels: &[&str]| {
        let mut app = Fake::font_book();
        let wanted = path(labels);
        let settled = settle(&mut app, Some(&wanted), &HELD);
        assert_eq!(app.logged(), ["cancel"], "{labels:?}");
        match settled.expect("settled") {
            Settled::Unchosen {
                refusal: Some(refusal),
                items,
                closed: true,
            } => (refusal, items),
            other => panic!("{labels:?}: {other:?}"),
        }
    };
    let (refusal, items) = refused(&["Add to", "Sans"]);
    assert_eq!(refusal, "menu item 'Sans' was not found");
    assert_eq!(items, "\"Bench Holdout\", \"Serif\u{2026}\"");
    let (refusal, items) = refused(&["Remove"]);
    assert_eq!(
        refusal,
        "menu item 'Remove' is disabled; no command was dispatched"
    );
    assert!(items.starts_with("\"Add to\" \u{25b8} ["), "{items}");
    let (refusal, items) = refused(&["Add to"]);
    assert!(refusal.contains("'Add to' opens a submenu"), "{refusal}");
    assert_eq!(items, "\"Bench Holdout\", \"Serif\u{2026}\"");
    let (refusal, _) = refused(&["Show in Finder", "Desktop"]);
    assert_eq!(refusal, "menu item 'Show in Finder' has no submenu");
}

#[test]
fn a_pressed_item_whose_menu_stays_open_is_closed_and_reported() {
    let mut app = Fake::font_book();
    app.press_closes = false;
    app.cancel_works = false;
    let wanted = path(&["Show in Finder"]);
    match settle(&mut app, Some(&wanted), &HELD).expect("settled") {
        Settled::Unchosen {
            refusal: Some(refusal),
            closed: true,
            ..
        } => assert!(
            refusal.contains("stayed open after 'Show in Finder' was pressed"),
            "{refusal}"
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        app.logged(),
        ["press Show in Finder", "cancel", "cancel", "escape"]
    );
}

#[test]
fn only_a_menu_the_press_opened_is_closed() {
    // A menu open before the press (another menu of the app) is not the
    // press's menu, and the press returns once the timeout passes.
    let mut app = Fake::font_book();
    app.open = vec![MenuWindow(9)];
    app.opens = None;
    let timeout = Duration::from_millis(30);
    let settled = settle_with(&mut app, &[MenuWindow(9)], None, timeout, &HELD).expect("settled");
    assert_eq!(settled, Settled::NoMenu);
    assert!(app.logged().is_empty());
    assert!(app.virtual_elapsed() >= timeout);
    assert_eq!(new_menu(&[MenuWindow(5)], &[MenuWindow(5)]), None);
    assert_eq!(
        new_menu(&[MenuWindow(5)], &[MenuWindow(5), MenuWindow(9)]),
        Some(MenuWindow(9))
    );
    assert_eq!(new_menu(&[], &[]), None);
}

#[test]
fn a_menu_that_ignores_cancel_and_escape_is_reported_open() {
    let mut app = Fake::font_book();
    app.cancel_works = false;
    app.escape_works = false;
    let settled = settle(&mut app, None, &HELD).expect("settled");
    assert!(
        matches!(settled, Settled::Unchosen { closed: false, .. }),
        "{settled:?}"
    );
}

#[test]
fn listing_stops_expanding_submenus_at_its_budget() {
    let many = vec![("Font", true, None); MAX_LISTED_ITEMS];
    let mut app = Fake {
        tree: std::collections::HashMap::from([
            (9, vec![("Add to", true, Some(20)), ("Open", true, None)]),
            (20, many),
        ]),
        ..Fake::default()
    };
    assert_eq!(listing(&mut app, &9), "\"Add to\" \u{25b8}, \"Open\"");
}

#[test]
fn a_menu_of_a_remote_panel_is_watched_in_its_service_and_belongs_to_the_host() {
    // Automator (pid 71991) shows its Save sheet's controls in window 26086
    // of openAndSavePanelService (pid 71995); the Where: popup's menu is a
    // window of the service, and its AXMenu reports Automator.
    let owners = |window| match window {
        26086 => Some(71995),
        26072 => Some(71991),
        _ => None,
    };
    assert_eq!(menu_process(71991, Some(26086), owners), 71995);
    assert_eq!(menu_process(71991, Some(26072), owners), 71991);
    assert_eq!(menu_process(71991, Some(9), owners), 71991);
    assert_eq!(
        menu_process(71991, None, |_| panic!("no window to look up")),
        71991
    );
    assert!(owns_menu(71991, 71995, 71991));
    assert!(owns_menu(71995, 71995, 71991));
    assert!(owns_menu(7581, 7581, 7581));
    // A menu another application shows over the point is not the target's.
    assert!(!owns_menu(512, 71995, 71991));
}
