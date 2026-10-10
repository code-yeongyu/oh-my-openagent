use senpi_desktop_core::backend::{Modifiers, MouseButton, PointerEvent};

use super::{coverage, event_points, Coverage, PointOwner};

const fn owner(pid: libc::pid_t, window: Option<u32>) -> PointOwner {
    PointOwner { pid, window }
}

#[test]
fn only_the_exact_target_window_owns_a_point() {
    // Target: process 10, window 100.
    assert_eq!(coverage(Some(owner(10, Some(100))), 10, 100), Coverage::Target);
    // Another process covers the point.
    assert_eq!(
        coverage(Some(owner(20, Some(200))), 10, 100),
        Coverage::Covered(owner(20, Some(200)))
    );
    // Another window of the same process (a panel) is not the target.
    assert_eq!(
        coverage(Some(owner(10, Some(101))), 10, 100),
        Coverage::Covered(owner(10, Some(101)))
    );
    // No hit, or a surface with no window, proves nothing.
    assert_eq!(coverage(None, 10, 100), Coverage::Unknown);
    assert_eq!(coverage(Some(owner(10, None)), 10, 100), Coverage::Unknown);
}

#[test]
fn a_drag_is_checked_at_both_ends_and_a_click_at_its_point() {
    let click = PointerEvent::Click {
        x: 5.0,
        y: 6.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };
    assert_eq!(event_points(&click), [(5.0, 6.0)]);
    let drag = PointerEvent::Drag {
        path: vec![(1.0, 2.0), (3.0, 4.0), (7.0, 8.0)],
        button: MouseButton::Left,
        modifiers: Modifiers::default(),
    };
    assert_eq!(event_points(&drag), [(1.0, 2.0), (7.0, 8.0)]);
}
