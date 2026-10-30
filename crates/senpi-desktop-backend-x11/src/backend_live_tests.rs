//! Live shared-transaction restore checks against Xvfb + xfwm4.

use std::process::Command;

use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::types::{DesktopPoint, DisplaySelector, Target};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::ConnectionExt as _;

use crate::X11Backend;

fn window_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("precondition: {name} is set"))
}

fn xdotool(args: &[&str]) {
    let status = Command::new("xdotool")
        .args(args)
        .status()
        .expect("run xdotool");
    assert!(status.success(), "xdotool {args:?} exited {status}");
}

#[test]
#[ignore = "live: needs Xvfb + xfwm4 + target, other and newer QA xterms"]
fn shared_restore_preserves_newer_user_focus_and_pointer() {
    let target = window_env("SENPI_X11_TARGET");
    let other = window_env("SENPI_X11_OTHER");
    let newer = window_env("SENPI_X11_NEWER");
    let (control, screen) = x11rb::connect(None).expect("control X11 connection");
    let root = control.setup().roots[screen].root;
    let target_xid = target.parse().expect("target is a decimal XID");
    let origin = control
        .translate_coordinates(target_xid, root, 0, 0)
        .expect("request target origin")
        .reply()
        .expect("read target origin");
    let click = (origin.dst_x + 40, origin.dst_y + 30);
    let mut backend = X11Backend::new(DisplaySelector::All).unwrap();
    backend.raise_window(&other).unwrap();
    xdotool(&["mousemove", "--sync", "100", "100"]);
    let front = backend.front_window().unwrap().expect("other is front");
    let cursor = backend.cursor_position().unwrap().expect("cursor is available");

    backend
        .pointer(
            &Target::Window(target.clone()),
            PointerEvent::Click {
                x: f64::from(click.0),
                y: f64::from(click.1),
                button: MouseButton::Left,
                count: 1,
                modifiers: Modifiers::default(),
            },
            &FrameGeometry::identity_global(),
            DeliveryMode::Foreground,
        )
        .unwrap();
    let action_cursor = backend.cursor_position().unwrap().expect("cursor after action");
    assert_eq!((action_cursor.x, action_cursor.y), (f64::from(click.0), f64::from(click.1)));
    xdotool(&["windowactivate", "--sync", &newer]);
    xdotool(&["mousemove", "--sync", "900", "700"]);

    backend.restore_front_window(&front).unwrap();
    backend.warp_cursor(cursor).unwrap();

    let after_front = backend.front_window().unwrap().expect("newer is front");
    let after_cursor = backend.cursor_position().unwrap().expect("cursor after restore");
    println!(
        "target={target} previous={} newer={newer} action_cursor=({},{}) \
         restored_front={} restored_cursor=({},{})",
        front.window_id.as_deref().unwrap_or(""),
        action_cursor.x,
        action_cursor.y,
        after_front.window_id.as_deref().unwrap_or(""),
        after_cursor.x,
        after_cursor.y
    );
    assert_eq!(after_front.window_id.as_deref(), Some(newer.as_str()));
    assert_eq!(after_cursor, DesktopPoint { x: 900.0, y: 700.0 });
}
