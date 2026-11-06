use super::holds::UserHolds;
use super::plan::{apply, plan, Open, Step};
use super::wire::{Input, Record, Route};

const SHIFT: u16 = 56;
const RIGHT_SHIFT: u16 = 60;
const OPTION: u16 = 58;
const A: u16 = 0;

fn press(id: u32, route: Route, input: Input) -> Open {
    Open { id, route, input, text: None }
}

fn holding(inputs: &[Input]) -> UserHolds {
    let mut user = UserHolds::default();
    for &input in inputs {
        user.set(input, true);
    }
    user
}

#[test]
fn open_presses_follow_presses_updates_and_releases() {
    let mut open = Vec::new();
    apply(&mut open, Record::Press { id: 1, route: Route::Hid, input: Input::Key(SHIFT), text: None });
    apply(&mut open, Record::Press {
        id: 2,
        route: Route::Window { pid: 9, wid: 4, x: 1.0, y: 1.0 },
        input: Input::Button(0),
        text: None,
    });
    apply(&mut open, Record::Update { id: 2, route: Route::Window { pid: 9, wid: 4, x: 50.0, y: 60.0 } });
    apply(&mut open, Record::Release { id: 1 });
    assert_eq!(open, [press(2, Route::Window { pid: 9, wid: 4, x: 50.0, y: 60.0 }, Input::Button(0))]);
}

#[test]
fn releases_latest_first_with_the_modifiers_still_held() {
    let open = [
        press(1, Route::Keyboard(9), Input::Key(SHIFT)),
        press(2, Route::Keyboard(9), Input::Key(OPTION)),
        press(3, Route::Keyboard(9), Input::Key(A)),
        press(4, Route::Window { pid: 9, wid: 4, x: 0.0, y: 0.0 }, Input::Button(0)),
    ];
    assert_eq!(plan(&open, UserHolds::default()), [
        Step::Post { id: 4, flags: None },
        Step::Post { id: 3, flags: Some(0x20000 | 0x80000) },
        Step::Post { id: 2, flags: Some(0x20000) },
        Step::Post { id: 1, flags: Some(0) },
    ]);
}

#[test]
fn never_releases_on_the_hid_route_what_the_user_holds() {
    let open = [press(1, Route::Hid, Input::Key(SHIFT)), press(2, Route::Hid, Input::Button(0))];
    // Negative control: nobody else holds them, so both are released.
    assert_eq!(plan(&open, UserHolds::default()), [
        Step::Post { id: 2, flags: None },
        Step::Post { id: 1, flags: Some(0) },
    ]);
    assert_eq!(plan(&open, holding(&[Input::Key(SHIFT), Input::Button(0)])), [
        Step::Leave { id: 2 },
        Step::Leave { id: 1 },
    ]);
    // Either Shift key holds the one Shift flag.
    assert_eq!(plan(&open[..1], holding(&[Input::Key(RIGHT_SHIFT)])), [Step::Leave { id: 1 }]);
    // A different button of the user's is not the engine's.
    assert_eq!(plan(&open[1..], holding(&[Input::Button(1)])), [Step::Post { id: 2, flags: None }]);
}

#[test]
fn hid_releases_keep_the_users_other_modifiers() {
    let open = [press(1, Route::Hid, Input::Key(SHIFT))];
    assert_eq!(plan(&open, holding(&[Input::Key(OPTION)])), [Step::Post { id: 1, flags: Some(0x80000) }]);
}

#[test]
fn per_process_releases_reach_only_the_target_and_ignore_the_user() {
    let open = [
        press(1, Route::Keyboard(9), Input::Key(SHIFT)),
        press(2, Route::Window { pid: 9, wid: 4, x: 0.0, y: 0.0 }, Input::Button(0)),
    ];
    assert_eq!(plan(&open, holding(&[Input::Key(SHIFT), Input::Key(OPTION), Input::Button(0)])), [
        Step::Post { id: 2, flags: None },
        Step::Post { id: 1, flags: Some(0) },
    ]);
}

#[test]
fn modifiers_held_on_another_lane_do_not_ride_on_a_release() {
    let open = [press(1, Route::Keyboard(9), Input::Key(SHIFT)), press(2, Route::Keyboard(10), Input::Key(A))];
    assert_eq!(plan(&open, UserHolds::default()), [
        Step::Post { id: 2, flags: Some(0) },
        Step::Post { id: 1, flags: Some(0) },
    ]);
}

#[test]
fn the_user_letting_go_ends_the_hold() {
    let mut user = holding(&[Input::Key(SHIFT)]);
    user.set(Input::Key(SHIFT), false);
    assert!(!user.holds(Input::Key(SHIFT)));
    assert_eq!(plan(&[press(1, Route::Hid, Input::Key(SHIFT))], user), [Step::Post { id: 1, flags: Some(0) }]);
}
