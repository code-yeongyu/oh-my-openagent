//! The guards omp 18.13.1 puts around every AX text insertion, window-level
//! and element-level alike (`macos/input.rs` `window_type`): a terminal is
//! never written, and in the background nothing is written once the target
//! came to the front after the input began.

use std::cell::RefCell;

use senpi_desktop_core::backend::DeliveryMode;
use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use super::insertion::{before_write, insert_unless_terminal, is_terminal_bundle};
use super::key_front::EntryFront;

const USER: libc::pid_t = 1;
const TARGET: libc::pid_t = 2;
const WID: u32 = 7;

fn running() -> CoreResult<()> {
    Ok(())
}

/// One insertion as `insert_selected_text` orders it: the guard right before
/// the write, then the write, recorded in `steps`.
fn insertion(
    terminal: bool,
    mode: DeliveryMode,
    front: libc::pid_t,
    check_stop: &dyn Fn() -> CoreResult<()>,
) -> (CoreResult<bool>, Vec<&'static str>) {
    let steps = RefCell::new(Vec::new());
    let result = insert_unless_terminal(
        terminal,
        || before_write(mode, EntryFront(Some(USER)), || Some(front), (TARGET, WID), check_stop),
        |behind_user| {
            steps.borrow_mut().push("probe");
            behind_user()?;
            steps.borrow_mut().push("write");
            Ok(true)
        },
    );
    (result, steps.into_inner())
}

#[test]
fn a_terminal_is_never_written_so_keys_follow() {
    let (inserted, steps) = insertion(true, DeliveryMode::Background, USER, &running);
    assert!(!inserted.unwrap());
    assert!(steps.is_empty());
    let (inserted, steps) = insertion(true, DeliveryMode::Foreground, TARGET, &running);
    assert!(!inserted.unwrap());
    assert!(steps.is_empty());
}

#[test]
fn terminals_are_known_by_bundle_identifier() {
    assert!(is_terminal_bundle("com.apple.Terminal"));
    assert!(is_terminal_bundle("com.mitchellh.ghostty"));
    assert!(!is_terminal_bundle("com.apple.TextEdit"));
}

#[test]
fn a_background_write_refuses_once_the_target_came_forward() {
    let (inserted, steps) = insertion(false, DeliveryMode::Background, USER, &running);
    assert!(inserted.unwrap());
    assert_eq!(steps, ["probe", "write"]);
    let (refused, steps) = insertion(false, DeliveryMode::Background, TARGET, &running);
    assert_eq!(refused.unwrap_err().code, ErrorCode::UserIntervened);
    assert_eq!(steps, ["probe"]);
    // A foreground write goes to the app raised for it.
    let (inserted, steps) = insertion(false, DeliveryMode::Foreground, TARGET, &running);
    assert!(inserted.unwrap());
    assert_eq!(steps, ["probe", "write"]);
}

#[test]
fn a_stopped_run_writes_nothing() {
    let stopped = || Err(DesktopError::input_failed("stopped"));
    let (refused, steps) = insertion(false, DeliveryMode::Background, USER, &stopped);
    assert_eq!(refused.unwrap_err().code, ErrorCode::InputFailed);
    assert_eq!(steps, ["probe"]);
}
