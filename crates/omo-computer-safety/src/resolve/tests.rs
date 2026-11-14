//! Resolution of the effective target from the window listing.

use omo_computer_core::listing::{Rect, WindowIdentity, WindowInfo};
use omo_computer_core::params::Point;
use omo_computer_core::untrusted::UntrustedText;

use super::{resolve, TargetRef};
use crate::gate::{Identity, Resolution, VerbKind};

fn listed(id: &str, pid: u32, bounds: Rect, z: u32, focused: bool) -> WindowInfo {
    WindowInfo {
        id: id.to_owned(),
        identity: WindowIdentity {
            window_number: None,
            hwnd: None,
            xid: None,
            pid,
            process_start: 0,
        },
        app: format!("app{pid}"),
        app_key: format!("app{pid}"),
        title: String::new(),
        bounds,
        display: "1".to_owned(),
        focused,
        is_on_screen: true,
        space: None,
        minimized: false,
        elevated: false,
        z,
        observation: UntrustedText,
    }
}

fn pid(resolution: &Resolution) -> Option<u32> {
    match resolution {
        Resolution::Window(Identity { pid, .. }) => Some(*pid),
        Resolution::Desktop | Resolution::Unreadable => None,
    }
}

#[test]
fn pointer_keyboard_and_window_targets_resolve_as_the_gate_needs() {
    let back = listed(
        "1",
        10,
        Rect {
            x: 0.0,
            y: 0.0,
            width: 500.0,
            height: 500.0,
        },
        1,
        true,
    );
    let front = listed(
        "2",
        20,
        Rect {
            x: 100.0,
            y: 100.0,
            width: 100.0,
            height: 100.0,
        },
        0,
        false,
    );
    let windows = vec![back, front];
    let points = [
        Point { x: 150.0, y: 150.0 },
        Point { x: 50.0, y: 50.0 },
        Point { x: 900.0, y: 900.0 },
    ];
    let desktop = resolve(
        Some(&windows),
        TargetRef::Desktop,
        VerbKind::Pointer,
        &points,
    );
    assert_eq!(
        desktop
            .iter()
            .map(|t| pid(&t.resolution))
            .collect::<Vec<_>>(),
        vec![Some(20), Some(10), None]
    );
    assert_eq!(desktop[2].resolution, Resolution::Desktop);
    let focus = resolve(
        Some(&windows),
        TargetRef::read(Some("desktop")),
        VerbKind::Keyboard,
        &[],
    );
    assert_eq!(
        pid(&focus[0].resolution),
        Some(10),
        "a keyboard verb resolves the focused window"
    );
    let window = resolve(
        Some(&windows),
        TargetRef::read(Some("2")),
        VerbKind::Pointer,
        &points[..1],
    );
    assert_eq!(
        pid(&window[0].resolution),
        Some(20),
        "a window target passes through"
    );
    let missing = resolve(
        Some(&windows),
        TargetRef::Window("9"),
        VerbKind::Pointer,
        &points[..1],
    );
    assert_eq!(missing[0].resolution, Resolution::Unreadable);
    let blind = resolve(None, TargetRef::Desktop, VerbKind::Pointer, &points);
    assert!(blind.iter().all(|t| t.resolution == Resolution::Unreadable));
    assert_eq!(
        resolve(None, TargetRef::Desktop, VerbKind::Keyboard, &[]).len(),
        1
    );
}
