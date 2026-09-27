//! Live input checks against a real X server with an EWMH window manager.
//! `#[ignore]`d: the QA script starts Xvfb, xfwm4, the xterms and the GTK
//! window, then passes their ids through the environment:
//!
//! - `SENPI_X11_TARGET`: an xterm in raw mode with mouse reporting on, whose
//!   shell runs `cat -v > $SENPI_X11_FIFO`;
//! - `SENPI_X11_OTHER`: a second window, active when the test starts;
//! - `SENPI_X11_GTK`: a window whose `WM_CLASS` names GTK.
//!
//! Each prints machine-read `key=value` facts for the QA evidence.

use std::fs::File;
use std::io::Read;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::Target;
use x11rb::protocol::xproto::Window;

use super::{InputServer, X11Input};

const HANG_GUARD: Duration = Duration::from_secs(30);
/// The X10/normal mouse report of a left press: `ESC [ M` then button 0
/// (+32 = space), as `cat -v` prints it.
const LEFT_PRESS_REPORT: &str = "^[[M ";

fn window_env(name: &str) -> Window {
    let value = std::env::var(name).unwrap_or_else(|_| panic!("precondition: {name} is set"));
    value
        .parse()
        .unwrap_or_else(|_| panic!("{name}={value} is a decimal XID"))
}

/// Starts reading the target's FIFO; `cat` opens it for writing only once
/// this side opened it, so the reader must exist before any input.
fn fifo_reader() -> mpsc::Receiver<String> {
    let path = std::env::var("SENPI_X11_FIFO").expect("precondition: SENPI_X11_FIFO is set");
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut fifo = File::open(path).unwrap();
        let mut buffer = [0_u8; 256];
        loop {
            let read = fifo.read(&mut buffer).unwrap();
            if read == 0
                || sender
                    .send(String::from_utf8_lossy(&buffer[..read]).into_owned())
                    .is_err()
            {
                return;
            }
        }
    });
    receiver
}

/// The window's root-coordinate centre, from the server.
fn centre<S: InputServer>(input: &X11Input<S>, window: Window) -> (f64, f64) {
    let (x, y) = input.server.translate(window, 0, 0).unwrap();
    (f64::from(-x) + 40.0, f64::from(-y) + 30.0)
}

#[test]
#[ignore = "live: needs Xvfb + xfwm4 + the QA xterms (see the module docs)"]
fn xtest_click_into_xterm() {
    // Given: the other window is active and the target's cat is reading
    let target = window_env("SENPI_X11_TARGET");
    let other = window_env("SENPI_X11_OTHER");
    let mut input = X11Input::connect().unwrap();
    input.raise_window(&other.to_string()).unwrap();
    let output = fifo_reader();
    let active_before = input.active_window();
    let (x, y) = centre(&input, target);
    let click = PointerEvent::Click {
        x,
        y,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };

    // When: a foreground XTEST click into the target
    input
        .pointer(
            &Target::Window(target.to_string()),
            &click,
            DeliveryMode::Foreground,
        )
        .unwrap();

    // Then: the xterm received the press, and activation came back
    let received = output
        .recv_timeout(HANG_GUARD)
        .expect("hang guard: no mouse report");
    let active_after = input.active_window();
    println!(
        "target={target} other={other} click_root=({x},{y}) received={received:?} \
         active_before={active_before:?} active_after={active_after:?}"
    );
    assert!(received.starts_with(LEFT_PRESS_REPORT), "{received:?}");
    assert_eq!(active_before, Some(other));
    assert_eq!(active_after, active_before);
}

#[test]
#[ignore = "live: needs Xvfb + xfwm4 + the QA GTK window (see the module docs)"]
fn background_click_into_a_gtk_window_is_refused() {
    let gtk = window_env("SENPI_X11_GTK");
    let mut input = X11Input::connect().unwrap();
    let class = input.server.wm_class(gtk).unwrap_or_default();
    let active_before = input.active_window();
    let click = PointerEvent::Click {
        x: 1.0,
        y: 1.0,
        button: MouseButton::Left,
        count: 1,
        modifiers: Modifiers::default(),
    };

    let error = input
        .pointer(&Target::Window(gtk.to_string()), &click, DeliveryMode::Background)
        .unwrap_err();

    let active_after = input.active_window();
    println!(
        "gtk={gtk} wm_class={:?} code={} message={:?} active_before={active_before:?} \
         active_after={active_after:?}",
        String::from_utf8_lossy(&class),
        error.code.as_str(),
        error.message
    );
    assert_eq!(error.code, ErrorCode::BackgroundUnavailable);
    assert!(error.message.contains("GTK"), "{}", error.message);
    assert_eq!(
        active_after, active_before,
        "a refusal never falls back to the foreground"
    );
}
