use std::cell::RefCell;

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use super::{cursor_on, place, Mover};

const INTENDED: (i32, i32) = (640, 360);

/// A scripted desktop: each move lands the cursor where the script says and
/// records which mover was used.
struct Desktop {
    lands: fn(Mover) -> (i32, i32),
    cursor: RefCell<(i32, i32)>,
    moves: RefCell<Vec<Mover>>,
}

impl Desktop {
    fn new(lands: fn(Mover) -> (i32, i32)) -> Self {
        Self {
            lands,
            cursor: RefCell::new((10, 10)),
            moves: RefCell::new(Vec::new()),
        }
    }

    fn place(&self) -> CoreResult<Mover> {
        place(
            INTENDED,
            |mover| {
                self.moves.borrow_mut().push(mover);
                *self.cursor.borrow_mut() = (self.lands)(mover);
                Ok(())
            },
            || Ok(*self.cursor.borrow()),
        )
    }

    fn moves(&self) -> Vec<Mover> {
        self.moves.borrow().clone()
    }
}

#[test]
fn the_cursor_is_on_the_point_within_one_pixel_per_axis() {
    let (x, y) = INTENDED;
    assert!(cursor_on(INTENDED, (x, y)));
    assert!(cursor_on(INTENDED, (x + 1, y - 1)));
    assert!(cursor_on(INTENDED, (x - 1, y + 1)));
    assert!(!cursor_on(INTENDED, (x + 2, y)));
    assert!(!cursor_on(INTENDED, (x, y - 2)));
    assert!(!cursor_on((i32::MIN, i32::MIN), (i32::MAX, i32::MAX)));
}

#[test]
fn a_sendinput_move_that_lands_is_the_only_move() {
    let desktop = Desktop::new(|_| INTENDED);

    assert_eq!(desktop.place(), Ok(Mover::SendInput));
    assert_eq!(desktop.moves(), [Mover::SendInput]);
}

#[test]
fn a_sendinput_move_that_does_not_land_falls_back_to_setcursorpos() {
    // Given: a desktop where the injected move leaves the cursor where it was
    let desktop = Desktop::new(|mover| match mover {
        Mover::SendInput => (10, 10),
        Mover::SetCursorPos => INTENDED,
    });

    assert_eq!(desktop.place(), Ok(Mover::SetCursorPos));
    assert_eq!(desktop.moves(), [Mover::SendInput, Mover::SetCursorPos]);
}

#[test]
fn a_cursor_no_mover_places_is_input_failed_naming_every_miss() {
    let desktop = Desktop::new(|mover| match mover {
        Mover::SendInput => (10, 10),
        Mover::SetCursorPos => (INTENDED.0 + 2, INTENDED.1),
    });

    let error = desktop.place().unwrap_err();

    assert_eq!(error.code, ErrorCode::InputFailed);
    assert!(error.message.contains("(640, 360)"), "{}", error.message);
    assert!(
        error.message.contains("SendInput left it at (10, 10)"),
        "{}",
        error.message
    );
    assert!(
        error.message.contains("SetCursorPos left it at (642, 360)"),
        "{}",
        error.message
    );
    assert!(
        error
            .message
            .contains("no pointer button or wheel was sent"),
        "{}",
        error.message
    );
    assert_eq!(desktop.moves(), [Mover::SendInput, Mover::SetCursorPos]);
}

#[test]
fn a_failed_move_stops_placement_before_any_other_mover() {
    let mut moves = Vec::new();
    let refused = place(
        INTENDED,
        |mover| {
            moves.push(mover);
            Err(DesktopError::input_failed(
                "the exact target lost foreground",
            ))
        },
        || Ok(INTENDED),
    );

    assert_eq!(
        refused.map_err(|error| error.code),
        Err(ErrorCode::InputFailed)
    );
    assert_eq!(moves, [Mover::SendInput]);
}

#[test]
fn a_failed_observation_stops_placement() {
    let mut moves = Vec::new();
    let unobserved = place(
        INTENDED,
        |mover| {
            moves.push(mover);
            Ok(())
        },
        || Err(DesktopError::input_failed("GetCursorPos failed")),
    );

    assert_eq!(
        unobserved.map_err(|error| error.message),
        Err("GetCursorPos failed".to_owned())
    );
    assert_eq!(moves, [Mover::SendInput]);
}
