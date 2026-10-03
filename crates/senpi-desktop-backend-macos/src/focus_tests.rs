use super::{first_front_window, hand_back, HandBack, WindowInfo};
use crate::front_app::{restore_step, user_front_pid, RestoreStep};

#[test]
fn chooses_first_visible_normal_window_of_frontmost_process() {
    // Given: the window server lists overlays and another process ahead of two document windows.
    let windows = [
        WindowInfo {
            pid: 12,
            window_number: 1,
            layer: 0,
            on_screen: true,
        },
        WindowInfo {
            pid: 7,
            window_number: 2,
            layer: 3,
            on_screen: true,
        },
        WindowInfo {
            pid: 7,
            window_number: 3,
            layer: 0,
            on_screen: false,
        },
        WindowInfo {
            pid: 7,
            window_number: 4,
            layer: 0,
            on_screen: true,
        },
        WindowInfo {
            pid: 7,
            window_number: 5,
            layer: 0,
            on_screen: true,
        },
    ];
    // When: the frontmost app is process 7.
    let selected = first_front_window(&windows, 7);
    // Then: the front-to-back first visible layer-zero document wins.
    assert_eq!(selected, Some(4));
}

#[test]
fn returns_none_when_no_normal_on_screen_window_matches() {
    // Given: only off-screen and non-normal windows belong to the frontmost process.
    let windows = [
        WindowInfo {
            pid: 7,
            window_number: 2,
            layer: 0,
            on_screen: false,
        },
        WindowInfo {
            pid: 7,
            window_number: 3,
            layer: 1,
            on_screen: true,
        },
    ];
    // When: selecting its front window.
    let selected = first_front_window(&windows, 7);
    // Then: no window identity is falsely captured.
    assert_eq!(selected, None);
}

#[test]
fn hand_back_reactivates_only_while_the_engine_activation_is_front() {
    // Given: Terminal (10) was front, the engine made TextEdit (20) key.
    // Then: TextEdit still front -> give focus back to Terminal.
    assert_eq!(hand_back(10, Some(20), Some(20)), HandBack::Reactivate);
    // Terminal already front again -> nothing to do.
    assert_eq!(hand_back(10, Some(20), Some(10)), HandBack::AlreadyFront);
    // The user switched to Finder (30) meanwhile -> leave Finder front.
    assert_eq!(hand_back(10, Some(20), Some(30)), HandBack::UserMovedOn);
    // The engine made nothing key and the snapshot is not front -> the user moved on.
    assert_eq!(hand_back(10, None, Some(30)), HandBack::UserMovedOn);
    // The front application is unknown -> keep the previous behaviour.
    assert_eq!(hand_back(10, Some(20), None), HandBack::Reactivate);
    assert_eq!(hand_back(10, None, None), HandBack::AlreadyFront);
}

fn window(pid: u32, layer: i32, on_screen: bool) -> WindowInfo {
    WindowInfo { pid, window_number: pid * 10, layer, on_screen }
}

#[test]
fn a_regular_front_process_is_the_user_front_app() {
    // Given: WindowServer's front process is a regular app.
    let windows = [window(9, 0, true)];

    // When
    let front = user_front_pid(5, &windows, |pid| pid == 5 || pid == 9);

    // Then
    assert_eq!(front, Some(5));
}

#[test]
fn an_accessory_panel_owner_in_front_yields_the_front_most_regular_window_owner() {
    // Given (#9084): an accessory app with a floating panel is WindowServer's front process, and the user's
    // Terminal owns the front-most normal window, ahead of TextEdit; a hidden regular window sits first.
    let (panel, hidden, terminal, textedit) = (40_u32, 50_u32, 60_u32, 70_u32);
    let windows = [
        window(panel, 3, true),
        window(hidden, 0, false),
        window(terminal, 0, true),
        window(textedit, 0, true),
    ];

    // When
    let front = user_front_pid(40, &windows, |pid| pid != 40);

    // Then
    assert_eq!(front, Some(60));
}

#[test]
fn with_no_regular_window_the_raw_front_process_is_kept() {
    // Given: only the accessory panel is on screen.
    let windows = [window(40, 3, true)];

    // When
    let front = user_front_pid(40, &windows, |_| false);

    // Then
    assert_eq!(front, Some(40));
}

#[test]
fn a_restore_waits_while_the_previous_app_is_front() {
    // Given: the previous app (5) is front again.
    // When
    let step = restore_step(5, Some(5), Some(7), |_| true);

    // Then
    assert_eq!(step, RestoreStep::Front);
}

#[test]
fn a_restore_reclaims_the_front_from_the_engines_own_activation_or_an_accessory() {
    // Given: the engine's target (7) or an accessory panel owner (40) holds the front, or none is known.
    // When
    let steps = [
        restore_step(5, Some(7), Some(7), |_| true),
        restore_step(5, Some(40), Some(7), |pid| pid != 40),
        restore_step(5, None, Some(7), |_| true),
    ];

    // Then
    assert_eq!(steps, [RestoreStep::Reclaim, RestoreStep::Reclaim, RestoreStep::Reclaim]);
}

#[test]
fn a_restore_leaves_an_app_the_user_switched_to_in_front() {
    // Given (#9056): after the action the user brought another regular app (9) to the front.
    // When
    let step = restore_step(5, Some(9), Some(7), |_| true);

    // Then
    assert_eq!(step, RestoreStep::UserMovedOn);
}
