//! Row 49's live legs on real X servers (`xvfb-run -a cargo test -p omo-computer-backend-x11
//! --locked --lib -- --ignored`). Each leg starts its own `Xvfb` (so its key presses never reach
//! another test's server) and reads it through a second, independent connection.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use omo_computer_core::backend::{InputEvent, Route};
use omo_computer_core::listing::Rect;
use omo_computer_core::window_frame::{judge, FrameOutcome};
use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _, CreateWindowAux, WindowClass};

use super::connection::InputConnection;
use super::live_x::{down, mapping, PrivateX};
use super::{InputSettings, X11Input};
use crate::release_helper::{HelperCommand, Witness};

const ENGINE: &str = "OMO_X11_TEST_DEAD_ENGINE";
const HELPER: &str = "OMO_X11_TEST_RELEASE_HELPER";
const SELF: &str = "input::live_tests::";

fn key(name: &str, down: bool) -> InputEvent {
    InputEvent::Key {
        key: name.to_owned(),
        down,
    }
}

/// This test binary, running one ignored test as a child process.
fn this_test(name: &str, env: (&str, &str), display: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().expect("test binary"));
    command
        .args(["--ignored", "--exact", &format!("{SELF}{name}")])
        .env(env.0, env.1)
        .env("DISPLAY", display);
    command
}

#[test]
#[ignore = "needs Xvfb"]
fn xtest_hold_is_released_when_the_input_drops() {
    let x = PrivateX::start();
    let oracle = x.oracle();
    let mut input = x.input(InputSettings::default());
    input
        .post(&key("x", true), Route::ForegroundHid)
        .expect("press");
    assert_eq!(down(&oracle).len(), 1, "the engine's key is down");
    drop(input);
    assert_eq!(
        down(&oracle),
        Vec::<u8>::new(),
        "dropping the input released it"
    );
}

#[test]
#[ignore = "needs Xvfb"]
fn scratch_remap_types_and_restores_the_mapping() {
    let x = PrivateX::start();
    let oracle = x.oracle();
    let before = mapping(&oracle);
    let mut input = x.input(InputSettings {
        keymap_remap: true,
        ..InputSettings::default()
    });
    let typed = input.post(
        &InputEvent::Text("\u{ac00}\u{b098}\u{1f600}x".into()),
        Route::ForegroundHid,
    );
    assert_eq!(typed.map(|delivered| delivered.count), Ok(4));
    assert_eq!(
        mapping(&oracle),
        before,
        "every scratch keycode got its own keysyms back"
    );
    assert_eq!(down(&oracle), Vec::<u8>::new(), "nothing left down");
}

/// The child entry of the release helper: only a spawned helper runs it.
#[test]
#[ignore = "child process entry of a_dead_engine_leaves_no_key_down_within_1500_ms"]
fn release_helper_process() {
    if std::env::var_os(HELPER).is_some() {
        crate::release_helper::run(&std::env::var("DISPLAY").expect("display")).expect("helper");
    }
}

#[test]
#[ignore = "needs Xvfb"]
fn a_dead_engine_leaves_no_key_down_within_1500_ms() {
    if std::env::var_os(ENGINE).is_some() {
        let display = std::env::var("DISPLAY").expect("display");
        let exe = std::env::current_exe().expect("test binary");
        let args = [
            "--ignored",
            "--exact",
            &format!("{SELF}release_helper_process"),
        ]
        .map(str::to_owned)
        .to_vec();
        let helper = HelperCommand {
            program: exe,
            args,
            env: vec![(HELPER.to_owned(), "1".to_owned())],
        };
        let witness = Witness::spawn(&helper, &display).expect("helper");
        let connection = InputConnection::connect(&display).expect("display");
        let mut input =
            X11Input::new(connection, InputSettings::default()).with_witness(Box::new(witness));
        input
            .post(&key("x", true), Route::ForegroundHid)
            .expect("press");
        std::process::abort();
    }
    let x = PrivateX::start();
    let oracle = x.oracle();
    let status = this_test(
        "a_dead_engine_leaves_no_key_down_within_1500_ms",
        (ENGINE, "1"),
        &x.display,
    )
    .status()
    .expect("child");
    assert!(!status.success(), "the child engine died mid-hold");
    let deadline = Instant::now() + Duration::from_millis(1500);
    while !down(&oracle).is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        down(&oracle),
        Vec::<u8>::new(),
        "the helper released the dead engine's key"
    );
}

#[test]
#[ignore = "needs Xvfb and xfwm4"]
fn frame_request_reads_back_the_frame_the_manager_applied() {
    let x = PrivateX::start();
    let oracle = x.oracle();
    let root = oracle.setup().roots[0].root;
    let mut wm = Command::new("xfwm4")
        .env("DISPLAY", &x.display)
        .stderr(Stdio::null())
        .spawn()
        .expect("xfwm4 is installed");
    let check = oracle
        .intern_atom(false, b"_NET_SUPPORTING_WM_CHECK")
        .expect("atom")
        .reply()
        .expect("atom")
        .atom;
    let deadline = Instant::now() + Duration::from_secs(10);
    let managed = || {
        let reply = oracle
            .get_property(false, root, check, AtomEnum::WINDOW, 0, 1)
            .expect("property")
            .reply();
        reply.is_ok_and(|reply| reply.value_len > 0)
    };
    while !managed() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(managed(), "xfwm4 manages the display");
    let window = oracle.generate_id().expect("id");
    let aux = CreateWindowAux::new().background_pixel(0);
    oracle
        .create_window(
            0,
            window,
            root,
            0,
            0,
            200,
            150,
            0,
            WindowClass::INPUT_OUTPUT,
            0,
            &aux,
        )
        .expect("create");
    oracle.map_window(window).expect("map");
    oracle.flush().expect("flush");
    std::thread::sleep(Duration::from_millis(500));
    let mut input = x.input(InputSettings::default());
    let asked = Rect {
        x: 40.0,
        y: 60.0,
        width: 320.0,
        height: 240.0,
    };
    let applied = input
        .set_frame(&window.to_string(), asked)
        .expect("read back");
    if let Err(error) = wm.kill().and_then(|()| wm.wait().map(drop)) {
        eprintln!("xfwm4 did not stop: {error}");
    }
    assert_eq!(
        judge(asked, applied.frame),
        FrameOutcome::Confirmed,
        "read back {:?}",
        applied.frame
    );
}
