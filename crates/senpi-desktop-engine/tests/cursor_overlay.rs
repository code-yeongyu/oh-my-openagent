//! Live private-helper checks; run explicitly in a logged-in macOS session.
#![cfg(target_os = "macos")]

#[path = "../../senpi-desktop-backend-macos/src/overlay/wire.rs"]
mod wire;

use core_graphics::event::CGEvent;
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2_app_kit::NSWorkspace;
use std::io;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

struct Helper {
    child: Child,
    input: ChildStdin,
    replies: Receiver<io::Result<wire::Reply>>,
}

impl Helper {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_senpi-desktop-engine"))
            .arg("--cursor-overlay")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let mut output = child.stdout.take().unwrap();
        let (sender, replies) = mpsc::channel();
        std::thread::spawn(move || loop {
            let reply = wire::read::<wire::Reply>(&mut output);
            let finished = reply.is_err();
            if sender.send(reply).is_err() || finished {
                break;
            }
        });
        let helper = Self {
            child,
            input,
            replies,
        };
        let ready = helper.reply();
        assert_eq!(ready.token, 0);
        assert_eq!(ready.pid, helper.child.id());
        assert!(ready.window_id > 0);
        helper
    }

    fn reply(&self) -> wire::Reply {
        self.replies
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap()
    }

    fn command(&mut self, command: wire::Command) -> wire::Reply {
        let token = command.token();
        wire::write(&mut self.input, &command).unwrap();
        let reply = self.reply();
        assert_eq!(reply.token, token);
        reply
    }
}

impl Drop for Helper {
    fn drop(&mut self) {
        if let Err(error) = self.child.kill() {
            eprintln!("test helper termination: {error}");
        }
        if let Err(error) = self.child.wait() {
            eprintln!("test helper reap: {error}");
        }
    }
}

#[test]
#[ignore = "live: requires a logged-in macOS session; run with --ignored --nocapture"]
fn helper_is_click_through_never_key_and_does_not_move_real_pointer_or_front_app() {
    // Given: observe the real desktop before creating any overlay.
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).unwrap();
    let before_pointer = CGEvent::new(source.clone()).unwrap().location();
    let before_app = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .unwrap()
        .processIdentifier();
    let mut helper = Helper::start();
    // When: show the overlay away from the physical pointer.
    let shown = helper.command(wire::Command::Target {
        token: 1,
        x: 180.0,
        y: 160.0,
    });
    // Then: inspect live native properties, not fixture-supplied receipts.
    assert!(shown.visible);
    assert!(shown.ignores_mouse_events);
    assert!(!shown.can_become_key);
    assert!(!shown.can_become_main);
    let after_pointer = CGEvent::new(source).unwrap().location();
    let after_app = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .unwrap()
        .processIdentifier();
    assert!((before_pointer.x - after_pointer.x).abs() < 1e-6);
    assert!((before_pointer.y - after_pointer.y).abs() < 1e-6);
    assert_eq!(before_app, after_app);
    println!("click_through=true never_key=true never_main=true pointer_unchanged=true front_app_unchanged=true");
}

#[test]
#[ignore = "live: requires a logged-in macOS session; run with --ignored --nocapture"]
fn hide_ack_confirms_native_window_is_absent_and_targets_cannot_reveal_it() {
    // Given: a visible native overlay.
    let mut helper = Helper::start();
    assert!(
        helper
            .command(wire::Command::Target {
                token: 1,
                x: 180.0,
                y: 160.0
            })
            .visible
    );
    // When: receive the WindowServer-checked hide acknowledgement.
    let hidden = helper.command(wire::Command::Hide { token: 2 });
    // Then: targets and stale resumes cannot show it during capture.
    assert!(!hidden.visible);
    assert!(
        !helper
            .command(wire::Command::Target {
                token: 3,
                x: 200.0,
                y: 180.0
            })
            .visible
    );
    assert!(!helper.command(wire::Command::Resume { token: 1 }).visible);
    assert!(helper.command(wire::Command::Resume { token: 2 }).visible);
    println!("hide_ack=true targets_stay_hidden=true stale_resume_rejected=true");
}
