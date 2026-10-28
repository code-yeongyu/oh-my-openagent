//! Ported from oh-my-pi `desktop/macos/applications.rs` tests (0838d2ab44),
//! plus the engine's own activation-policy invariant.

use std::cell::Cell;
use std::path::Path;
use std::time::Duration;

use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication};
use senpi_desktop_core::error::CoreResult;
use senpi_desktop_core::protocol_params::AppsListParams;
use senpi_desktop_core::types::{Application, DesktopWindow};

use super::document::{document_path, document_url, shown_name, showing, title_names, wait_for};
use super::inventory::is_helper;
use super::open::{ask_for_window, first_window, open_running};
use super::windows::in_ax_windows;

fn window(id: &str) -> DesktopWindow {
    DesktopWindow {
        id: id.into(),
        title: String::new(),
        app: "Contacts".into(),
        pid: Some(4105),
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        focused: false,
        is_on_screen: None,
        elevated: None,
    }
}

fn titled(id: &str, title: &str) -> DesktopWindow {
    DesktopWindow { title: title.into(), ..window(id) }
}

fn id(found: Option<DesktopWindow>) -> Option<String> {
    found.map(|window| window.id)
}

fn ids(windows: Vec<DesktopWindow>) -> Vec<String> {
    windows.into_iter().map(|w| w.id).collect()
}

#[test]
fn a_running_application_without_a_window_is_asked_once_and_its_first_window_returned() {
    let reopened = Cell::new(false);
    let polls = Cell::new(0);
    let found = first_window(
        true,
        Duration::from_secs(60),
        || {
            polls.set(polls.get() + 1);
            Some(if reopened.get() && polls.get() > 2 { vec![window("187")] } else { vec![] })
        },
        || false,
        || {
            assert!(!reopened.replace(true), "the application is asked once");
            true
        },
        || Ok(()),
    )
    .expect("first window");
    assert!(reopened.get());
    assert_eq!(id(found).as_deref(), Some("187"));
}

#[test]
fn a_launch_is_awaited_for_its_first_window_without_asking_for_one() {
    let polls = Cell::new(0);
    let found = first_window(
        false,
        Duration::from_secs(60),
        || {
            polls.set(polls.get() + 1);
            Some(if polls.get() > 3 { vec![window("90")] } else { vec![] })
        },
        || false,
        || panic!("a launch shows its first window itself"),
        || Ok(()),
    )
    .expect("first window");
    assert_eq!(id(found).as_deref(), Some("90"));
}

#[test]
fn a_shown_window_returns_at_once_and_a_missing_one_only_waits_out_the_bound() {
    let no_reopen = || -> bool { panic!("an application with a window is not asked again") };
    let no_wait = || -> CoreResult<()> { panic!("no poll interval is slept") };
    let unlisted = || false;
    let found = first_window(true, Duration::from_secs(60), || Some(vec![window("12"), window("11")]), unlisted, no_reopen, no_wait);
    assert_eq!(id(found.expect("window")).as_deref(), Some("12"));
    let found = first_window(false, Duration::ZERO, || Some(vec![]), unlisted, no_reopen, no_wait);
    assert!(found.expect("no window").is_none());
    let found = first_window(true, Duration::from_secs(60), || Some(vec![]), unlisted, || false, no_wait);
    assert!(found.expect("no window").is_none());
    let found = first_window(true, Duration::from_secs(60), || None, unlisted, no_reopen, no_wait);
    assert!(found.expect("no window").is_none());
}

#[test]
fn an_application_showing_only_a_window_capture_leaves_out_is_not_asked_for_one() {
    let found = first_window(
        true,
        Duration::from_secs(60),
        || Some(vec![]),
        || true,
        || panic!("an application showing a window is not asked for one"),
        || panic!("no window is awaited"),
    );
    assert!(found.expect("no window").is_none());
}

#[test]
fn a_hidden_application_with_no_open_window_is_reopened_after_unhiding() {
    let reopened = Cell::new(false);
    let reopen = || {
        reopened.set(true);
        true
    };
    let here = || false;
    assert!(ask_for_window(true, || true, || false, here, reopen));
    assert!(reopened.get());
    reopened.set(false);
    assert!(ask_for_window(true, || true, || true, here, reopen));
    assert!(!reopened.get());
    assert!(ask_for_window(false, || panic!("not hidden"), || panic!("not read"), here, reopen));
    assert!(reopened.get());
}

#[test]
fn an_application_with_a_window_on_another_space_is_not_reopened() {
    let reopen = || -> bool { panic!("the reopen event was sent") };
    assert!(!ask_for_window(false, || panic!("not hidden"), || panic!("not read"), || true, reopen));
    assert!(!ask_for_window(true, || true, || false, || true, reopen));
}

#[test]
fn an_application_that_exited_since_it_was_listed_is_read_as_its_new_process() {
    let contacts = Application {
        id: "com.apple.AddressBook".into(),
        name: "Contacts".into(),
        path: "/System/Applications/Contacts.app".into(),
        running: true,
        pid: Some(4105),
    };
    let relaunched = Application { pid: Some(4200), ..contacts.clone() };
    let opened = open_running(
        contacts,
        4105,
        |pid| Some(if pid == 4200 { vec![window("187")] } else { vec![] }),
        || false,
        |launched| {
            launched(relaunched);
            true
        },
        || Ok(()),
    )
    .expect("opened");
    assert_eq!(opened.pid, Some(4200));
    assert_eq!(opened.window.map(|window| window.id).as_deref(), Some("187"));
}

#[test]
fn an_opened_window_is_never_a_compositor_surface() {
    let listed = vec![window("501"), window("500")];
    assert_eq!(ids(in_ax_windows(listed.clone(), Some(&[500]))), ["500"]);
    assert_eq!(in_ax_windows(listed, None).len(), 2);
}

#[test]
fn an_opened_document_returns_the_window_titled_with_its_name() {
    let listed = vec![titled("1", "Open"), titled("2", "notes.txt")];
    assert_eq!(ids(showing(listed.clone(), Some("notes.txt"))), ["2"]);
    assert!(showing(vec![titled("1", "Open")], Some("notes.txt")).is_empty());
    assert_eq!(ids(showing(listed, None)), ["1", "2"]);
    assert_eq!(ids(showing(vec![window("3"), window("4")], Some("notes.txt"))), ["3", "4"]);
}

#[test]
fn a_window_titled_with_a_longer_name_does_not_show_the_opened_document() {
    let listed = vec![titled("1", "data.txt"), titled("2", "a.txt.bak — Edited"), titled("3", "a.txt — Edited")];
    assert_eq!(ids(showing(listed, Some("a.txt"))), ["3"]);
    assert!(showing(vec![titled("1", "data.txt")], Some("a.txt")).is_empty());
    for title in ["a.txt", "Preview: a.txt", "a.txt (page 1 of 2)", "project | a.txt"] {
        assert!(title_names(title, "a.txt"), "{title}");
    }
}

#[test]
fn waits_for_an_application_that_starts_after_the_request() {
    let mut polls = 0;
    let found = wait_for(
        Duration::from_secs(5),
        || {
            polls += 1;
            (polls == 3).then_some("Finder")
        },
        || Ok(()),
    );
    assert_eq!(found.unwrap(), Some("Finder"));
    assert_eq!(polls, 3);
    let never = wait_for(Duration::from_millis(20), || None::<()>, || {
        std::thread::sleep(Duration::from_millis(5));
        Ok(())
    });
    assert_eq!(never.unwrap(), None);
}

#[test]
fn a_revealed_symlink_is_selected_as_the_link_in_its_own_folder() {
    let root = std::env::temp_dir().join(format!("senpi-desktop-reveal-{}", std::process::id()));
    let (work, archive) = (root.join("work"), root.join("archive"));
    std::fs::create_dir_all(&work).unwrap();
    std::fs::create_dir_all(&archive).unwrap();
    let original = archive.join("original.pdf");
    std::fs::write(&original, "x").unwrap();
    let link = work.join("link.pdf");
    std::os::unix::fs::symlink(&original, &link).unwrap();
    let url_path = |target: &Path| document_url(target.to_str().unwrap(), true).unwrap().path().unwrap().to_string();
    assert_eq!(url_path(&link), link.to_str().unwrap());
    assert_eq!(shown_name(document_path(link.to_str().unwrap(), true).as_deref(), true).as_deref(), Some("work"));
    assert_eq!(url_path(&original), original.to_str().unwrap());
    assert_eq!(
        shown_name(document_path(original.to_str().unwrap(), false).as_deref(), false).as_deref(),
        Some("original.pdf")
    );
    assert!(document_path(root.join("missing.pdf").to_str().unwrap(), true).is_none());
    let dangling = work.join("dangling.pdf");
    std::os::unix::fs::symlink(archive.join("gone.pdf"), &dangling).unwrap();
    assert_eq!(url_path(&dangling), dangling.to_str().unwrap());
    assert!(document_path(dangling.to_str().unwrap(), false).is_none());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn agents_background_apps_and_extensions_are_helpers_and_regular_apps_are_not() {
    let root = std::env::temp_dir().join(format!("senpi-desktop-helpers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let bundle = |name: &str, flags: &str| {
        let contents = root.join(name).join("Contents");
        std::fs::create_dir_all(&contents).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict>{flags}</dict></plist>\n"),
        )
        .unwrap();
        root.join(name)
    };
    assert!(!is_helper(&bundle("Notes.app", "<key>LSUIElement</key><false/>")));
    assert!(is_helper(&bundle("Agent.app", "<key>LSUIElement</key><string>1</string>")));
    assert!(is_helper(&bundle("Daemon.app", "<key>LSBackgroundOnly</key><true/>")));
    assert!(is_helper(&bundle("Notes.appex", "")));
    assert!(!is_helper(&bundle("Other.app", "")));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn listing_applications_keeps_the_engine_out_of_the_dock() {
    let listed = super::list(&AppsListParams { query: Some("finder".into()), running_only: None }).expect("inventory");
    assert!(listed.iter().any(|app| app.id == "com.apple.finder"), "{listed:?}");
    // A regular policy is the only one with a Dock tile and app switcher entry;
    // an engine without an NSApplication reads as unregistered (-1) or prohibited.
    let policy = NSRunningApplication::currentApplication().activationPolicy();
    assert_ne!(policy, NSApplicationActivationPolicy::Regular, "{policy:?}");
}
