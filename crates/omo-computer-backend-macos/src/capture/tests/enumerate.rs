//! The own window enumerator (design row M1).

use omo_computer_core::backend::{CaptureOptions, Target, WindowFilter};

use super::kit::{window, FakeOs, OWN_PID};
use crate::capture::enumerate::MAX_LISTED;
use crate::capture::types::AxWindowFacts;
use crate::capture::{CaptureRouteTaken, Capturer};

const NO_CURSOR: CaptureOptions = CaptureOptions {
    cursor: false,
    crosshair: None,
    region: None,
};

#[test]
fn window_identity_survives_pid_reuse() {
    let mut os = FakeOs::with_windows(vec![window(7, 42), window(8, 42)]);
    os.starts.insert(42, 1_000);
    let mut capturer = Capturer::new(os, OWN_PID);
    let first = capturer
        .windows(&WindowFilter::default())
        .expect("first listing");
    assert_eq!(first.windows.len(), 2);
    assert!(first
        .windows
        .iter()
        .all(|w| w.identity.process_start == 1_000));
    assert_eq!(
        capturer.os().start_reads.get(&42),
        Some(&1),
        "one proc_pidinfo per pid per listing"
    );

    // pid 42 exits and the pid is reused by a new process with one window.
    capturer.os_mut().windows = vec![window(9, 42)];
    capturer.os_mut().starts.insert(42, 2_000);
    let second = capturer
        .windows(&WindowFilter::default())
        .expect("second listing");
    assert_eq!(second.windows.len(), 1);
    let identity = &second.windows[0].identity;
    assert_eq!(
        (identity.window_number, identity.pid, identity.process_start),
        (Some(9), 42, 2_000)
    );
    assert_ne!(
        identity, &first.windows[0].identity,
        "a reused pid is a different identity"
    );
}

#[test]
fn no_listing_record_has_identity_none() {
    let mut os = FakeOs::with_windows(vec![window(1, 10), window(2, 99), window(3, 11)]);
    os.starts.remove(&99); // exited between the list and the proc_pidinfo read
    let mut capturer = Capturer::new(os, OWN_PID);
    let list = capturer.windows(&WindowFilter::default()).expect("listing");
    let numbers: Vec<_> = list
        .windows
        .iter()
        .map(|w| w.identity.window_number)
        .collect();
    assert_eq!(numbers, vec![Some(1), Some(3)]);
    assert!(list
        .windows
        .iter()
        .all(|w| w.identity.process_start > 0
            && w.id == w.identity.window_number.unwrap().to_string()));
}

#[test]
fn windows_60_truncated_all_ids_reachable() {
    let windows = (1..=60).map(|n| window(n, 500 + n)).collect();
    let mut capturer = Capturer::new(FakeOs::with_windows(windows), OWN_PID);
    let list = capturer.windows(&WindowFilter::default()).expect("listing");
    assert_eq!(list.windows.len(), MAX_LISTED);
    assert!(
        list.truncated,
        "a cut listing says so instead of hard-capping silently"
    );
    let frame = capturer.capture(&Target::Window("60".into()), &NO_CURSOR);
    assert!(
        frame.is_ok(),
        "an id past the cut is still reachable: {frame:?}"
    );
}

#[test]
fn own_windows_and_non_application_layers_are_not_listed() {
    let mut menubar = window(2, 77);
    menubar.layer = 25;
    let os = FakeOs::with_windows(vec![window(1, OWN_PID), menubar, window(3, 78)]);
    let mut capturer = Capturer::new(os, OWN_PID);
    let list = capturer.windows(&WindowFilter::default()).expect("listing");
    assert_eq!(
        list.windows
            .iter()
            .map(|w| w.id.as_str())
            .collect::<Vec<_>>(),
        vec!["3"]
    );
    let filtered = capturer
        .windows(&WindowFilter {
            app: None,
            title: Some("nothing".into()),
            pid: None,
        })
        .expect("filtered");
    assert!(filtered.windows.is_empty());
}

#[test]
fn space_move_never_switches_user_space() {
    let mut off = window(5, 60);
    off.on_screen = false;
    let mut os = FakeOs::with_windows(vec![off]);
    os.spaces.insert(5, "3".into());
    let mut capturer = Capturer::new(os, OWN_PID);
    let list = capturer.windows(&WindowFilter::default()).expect("listing");
    assert_eq!(list.windows[0].space.as_deref(), Some("3"));
    assert!(!list.windows[0].is_on_screen);
    capturer
        .capture(&Target::Window("5".into()), &NO_CURSOR)
        .expect("off-Space capture");
    assert_eq!(capturer.last_route(), Some(CaptureRouteTaken::Helper));
    assert_eq!(
        capturer.os().helper.requests.len(),
        1,
        "one desktop-independent still, nothing else"
    );
}

#[test]
fn background_app_focused_window_is_not_focused() {
    let mut os = FakeOs::with_windows(vec![window(1, 10), window(2, 20), window(3, 20)]);
    // Every running app keeps its own AXFocusedWindow; only app 20 is frontmost.
    for number in [1, 2] {
        os.ax.insert(
            number,
            AxWindowFacts {
                focused_in_app: true,
                ..AxWindowFacts::default()
            },
        );
    }
    os.frontmost = Some(20);
    let mut capturer = Capturer::new(os, OWN_PID);
    let focused = |capturer: &mut Capturer<FakeOs>| -> Vec<String> {
        let list = capturer.windows(&WindowFilter::default()).expect("listing");
        list.windows
            .into_iter()
            .filter(|w| w.focused)
            .map(|w| w.id)
            .collect()
    };
    assert_eq!(
        focused(&mut capturer),
        vec!["2".to_string()],
        "a background app's focused window is not the focused window"
    );

    capturer.os_mut().frontmost = None;
    assert!(
        focused(&mut capturer).is_empty(),
        "no frontmost app, no focused window"
    );
}
