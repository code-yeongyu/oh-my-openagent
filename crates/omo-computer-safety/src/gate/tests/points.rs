//! A multi-point request (a drag's `from`, `to` and every `path[]` point) is refused whole
//! `InvalidTarget{drag_destination}` when any point is refused, naming the point and the
//! refusing stage's own refusal, before the button goes down.

use omo_computer_core::backend::Refusal;
use omo_computer_core::listing::{Rect, WindowIdentity, WindowInfo};
use omo_computer_core::params::Point;
use omo_computer_core::untrusted::UntrustedText;

use super::super::{gate, Gate, PointTarget, Resolution, VerbKind};
use super::{at, exec, self_set, tables, window, TERMINAL};
use crate::resolve::{resolve, TargetRef};

fn wire(refusal: &Refusal) -> (&'static str, Option<&'static str>) {
    (refusal.code.wire(), refusal.reason)
}

fn drag(points: Vec<PointTarget>) -> Result<(), (Gate, Refusal, Option<Point>, Refusal)> {
    let set_ = self_set();
    gate(&exec(VerbKind::Pointer), &tables(&set_), || points)
        .map(drop)
        .map_err(|refused| {
            let drag = refused.drag.expect("a multi-point refusal names its point");
            (refused.gate, refused.refusal, drag.point, drag.inner)
        })
}

fn notes(x: f64, y: f64) -> PointTarget {
    at(x, y, window(4242, "com.example.Notes"))
}

#[test]
fn gate_refuses_a_multi_point_request_when_any_point_is_refused() {
    assert_eq!(
        drag(vec![notes(1.0, 1.0), notes(2.0, 2.0), notes(3.0, 3.0)]),
        Ok(())
    );
    let cases: [(PointTarget, (&str, Option<&str>)); 5] = [
        (
            at(9.0, 9.0, window(TERMINAL, "com.example.Terminal")),
            ("ProtectedProcess", Some("self_target")),
        ),
        (
            at(9.0, 9.0, window(5, "com.apple.SecurityAgent")),
            ("InvalidTarget", Some("protected_surface")),
        ),
        (
            at(9.0, 9.0, window(6, "com.bitwarden.desktop")),
            ("ControlRequired", Some("denied_app")),
        ),
        (
            at(9.0, 9.0, Resolution::Unreadable),
            ("BackgroundUnavailable", Some("target_unknown")),
        ),
        (
            PointTarget {
                reserved_by_other: true,
                ..notes(9.0, 9.0)
            },
            ("InputBusy", Some("window")),
        ),
    ];
    for (bad, inner) in cases {
        // The refused point as `to`, and as a `path[]` point between `from` and `to`.
        for points in [
            vec![notes(1.0, 1.0), bad.clone()],
            vec![notes(1.0, 1.0), bad.clone(), notes(3.0, 3.0)],
        ] {
            let (gate_, refusal, point, refused_by) =
                drag(points).expect_err("the whole drag is refused");
            assert_eq!(gate_, Gate::Target);
            assert_eq!(wire(&refusal), ("InvalidTarget", Some("drag_destination")));
            assert_eq!(point, Some(Point { x: 9.0, y: 9.0 }));
            assert_eq!(wire(&refused_by), inner);
            assert!(refusal.row().is_ok() && refused_by.row().is_ok());
        }
    }
}

fn listed(id: &str, pid: u32, app: &str, bounds: Rect, z: u32) -> WindowInfo {
    WindowInfo {
        id: id.to_owned(),
        identity: WindowIdentity {
            window_number: None,
            hwnd: None,
            xid: None,
            pid,
            process_start: 0,
        },
        app: app.to_owned(),
        app_key: app.to_owned(),
        title: String::new(),
        bounds,
        display: "1".to_owned(),
        focused: false,
        is_on_screen: true,
        space: None,
        minimized: false,
        elevated: false,
        z,
        observation: UntrustedText,
    }
}

#[test]
fn a_window_target_drag_resolves_a_point_outside_its_frame_as_the_desktop_does() {
    let windows = vec![
        listed(
            "1",
            4242,
            "com.example.Notes",
            Rect {
                x: 0.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            1,
        ),
        listed(
            "2",
            TERMINAL,
            "com.example.Terminal",
            Rect {
                x: 200.0,
                y: 0.0,
                width: 100.0,
                height: 100.0,
            },
            0,
        ),
    ];
    let points = [Point { x: 10.0, y: 10.0 }, Point { x: 250.0, y: 50.0 }];
    let resolved = resolve(
        Some(&windows),
        TargetRef::Window("1"),
        VerbKind::Pointer,
        &points,
    );
    assert_eq!(resolved.len(), 2);
    let (_, refusal, point, inner) = drag(resolved).expect_err("the drop lands on the terminal");
    assert_eq!(wire(&refusal), ("InvalidTarget", Some("drag_destination")));
    assert_eq!(point, Some(Point { x: 250.0, y: 50.0 }));
    assert_eq!(wire(&inner), ("ProtectedProcess", Some("self_target")));
}
