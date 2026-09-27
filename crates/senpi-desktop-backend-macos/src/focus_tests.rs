use super::{first_front_window, WindowInfo};

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
