use std::cell::{Cell, RefCell};

use super::{
    drag_session_outcome, picked_up_refusal, refuse_drag_source, stroke_path, LeftPress,
    StartPoint, Stroke, DRAG_TRACKING_ROLES,
};
use crate::error::{DesktopError, ErrorCode};
use crate::types::DesktopWindow;

fn background_window(app: &str) -> DesktopWindow {
    DesktopWindow {
        id: "42".to_string(),
        title: String::new(),
        app: app.to_string(),
        pid: Some(7),
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        focused: false,
        is_on_screen: None,
        elevated: None,
    }
}

#[test]
fn background_drags_and_holds_run_only_on_controls_that_track_them() {
    let window = background_window("Finder");
    for kind in ["drag", "mouse hold"] {
        let press = LeftPress {
            kind,
            window: &window,
            start: (3.0, 4.0),
        };
        // Finder's icons and rows, a table cell, and anything unread can begin
        // a drag-and-drop session.
        let role = |name: &str| StartPoint::Role(name.to_string());
        for start in [
            role("AXImage"),
            role("AXRow"),
            role("AXCell"),
            role("AXWebArea"),
            StartPoint::Unread,
            StartPoint::Covered,
        ] {
            let error = refuse_drag_source(press, |_, _| start.clone())
                .expect_err("refused before posting");
            assert_eq!(error.code, ErrorCode::BackgroundUnavailable, "{start:?}");
            assert!(
                error.message.contains("nothing was sent"),
                "{}",
                error.message
            );
            assert!(
                error
                    .message
                    .contains(&format!("the {kind} on window 42 (Finder)")),
                "{}",
                error.message
            );
        }
        // A covering window of the same application is named as such.
        let error = refuse_drag_source(press, |_, _| StartPoint::Covered).expect_err("covered");
        assert!(
            error.message.contains("another window of the application"),
            "{}",
            error.message
        );
        for name in DRAG_TRACKING_ROLES {
            refuse_drag_source(press, |_, _| role(name)).expect(name);
        }
    }
    // The point read is where the press goes down.
    let at = Cell::new(None);
    let press = LeftPress {
        kind: "drag",
        window: &window,
        start: (3.0, 4.0),
    };
    assert!(refuse_drag_source(press, |x, y| {
        at.set(Some((x, y)));
        StartPoint::Unread
    })
    .is_err());
    assert_eq!(at.get(), Some((3.0, 4.0)));
}

#[test]
fn a_drag_that_picks_up_an_item_goes_back_to_its_start_and_is_released_there() {
    use Stroke::{Down, Dragged, Up};
    let path = [(1.0, 1.0), (5.0, 5.0), (9.0, 9.0), (13.0, 13.0)];
    // The source begins a drag-and-drop session while it handles the move to
    // 5: carried on, the item would drop wherever the user's pointer is.
    let checks = Cell::new(0);
    let picked_up = || {
        checks.set(checks.get() + 1);
        checks.get() > 1
    };
    let mut posted = Vec::new();
    let session = stroke_path(&path, picked_up, |stroke, at| {
        posted.push((stroke, at.0));
        Ok(())
    });
    assert!(session.expect("stroked"));
    assert_eq!(
        posted,
        [(Down, 1.0), (Dragged, 5.0), (Dragged, 1.0), (Up, 1.0)]
    );
    let error = picked_up_refusal(&background_window("Finder"));
    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(
        error.message.contains("released there"),
        "{}",
        error.message
    );
}

#[test]
fn a_picked_up_drag_whose_move_back_fails_is_still_released() {
    use Stroke::{Down, Dragged, Up};
    let path = [(1.0, 1.0), (5.0, 5.0), (9.0, 9.0)];
    let checks = Cell::new(0);
    let picked_up = || {
        checks.set(checks.get() + 1);
        checks.get() > 1
    };
    let mut posted = Vec::new();
    let result = stroke_path(&path, picked_up, |stroke, at| {
        posted.push((stroke, at.0));
        if stroke == Dragged && at.0 == 1.0 {
            return Err(DesktopError::input_failed("move back failed"));
        }
        Ok(())
    });
    // The release goes out where the stroke was last known to be: the move
    // back was attempted, so at the start.
    assert_eq!(
        result.expect_err("the failed post").message,
        "move back failed"
    );
    assert_eq!(
        posted,
        [(Down, 1.0), (Dragged, 5.0), (Dragged, 1.0), (Up, 1.0)]
    );
}

#[test]
fn a_drag_whose_post_fails_is_still_released_where_it_got_to() {
    use Stroke::{Down, Dragged, Up};
    let path = [(1.0, 1.0), (5.0, 5.0), (9.0, 9.0)];
    let mut posted = Vec::new();
    let result = stroke_path(
        &path,
        || false,
        |stroke, at| {
            posted.push((stroke, at.0));
            if stroke == Dragged && at.0 == 5.0 {
                return Err(DesktopError::input_failed("post failed"));
            }
            Ok(())
        },
    );
    assert_eq!(result.expect_err("the failed post").message, "post failed");
    assert_eq!(posted, [(Down, 1.0), (Dragged, 5.0), (Up, 5.0)]);
    // A whole stroke with no session reports none.
    let mut posted = Vec::new();
    let session = stroke_path(
        &path,
        || false,
        |stroke, at| {
            posted.push((stroke, at.0));
            Ok(())
        },
    );
    assert!(!session.expect("stroked"));
    assert_eq!(
        posted,
        [(Down, 1.0), (Dragged, 5.0), (Dragged, 9.0), (Up, 9.0)]
    );
}

#[test]
fn a_drag_that_starts_a_drag_and_drop_session_reports_its_drop_as_unconfirmed() {
    let window = background_window("Font Book");
    // `reads` are the drag pasteboard's change counts after the release, in
    // order; the count before the press was 7.
    let run = |reads: &[isize]| {
        let next = Cell::new(0);
        let log = RefCell::new(Vec::new());
        let outcome = drag_session_outcome(
            &window,
            7,
            || {
                let count = reads[next.get()];
                next.set(next.get() + 1);
                log.borrow_mut().push(format!("read {count}"));
                count
            },
            || log.borrow_mut().push("caught up".to_owned()),
        );
        (
            outcome.map_err(|error| (error.code, error.message)),
            log.into_inner(),
        )
    };
    // Font Book wrote the drag pasteboard while it handled the routed drag:
    // its session may drop the font at the path's end, elsewhere or nowhere,
    // so the call fails with the drop unconfirmed instead of returning as if
    // it had moved, and says to read the target first.
    let (outcome, log) = run(&[8]);
    assert_eq!(log, vec!["read 8".to_owned()]);
    let (code, message) = outcome.unwrap_err();
    assert_eq!(code, ErrorCode::InputFailed);
    assert!(message.contains("could not be confirmed"), "{message}");
    assert!(
        message.contains("may already have been dropped"),
        "{message}"
    );
    assert!(message.contains("before retrying"), "{message}");
    // A source that begins its session only once it catches up with the
    // events is found by the read after the round trip.
    let (outcome, log) = run(&[7, 9]);
    assert_eq!(
        log,
        vec![
            "read 7".to_owned(),
            "caught up".to_owned(),
            "read 9".to_owned()
        ]
    );
    assert_eq!(outcome.unwrap_err().0, ErrorCode::InputFailed);
    // A drag inside a view (a slider, a selection) leaves the pasteboard alone.
    assert_eq!(
        run(&[7, 7]),
        (
            Ok(()),
            vec![
                "read 7".to_owned(),
                "caught up".to_owned(),
                "read 7".to_owned()
            ]
        )
    );
}
