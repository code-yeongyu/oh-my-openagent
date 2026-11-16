//! apps.list / apps.open on scripted sources (fixtures apps-list-resolves-bundle,
//! apps-open-options-snapshot-one-read, apps-open-unknown-key-refused).

use omo_computer_core::apps::APP_UNKNOWN;
use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::AppSource;

use super::list::list;
use super::open::{open, OpenOptions, Opened};
use super::seam::{AppsOs, InstalledApp, RunningApp};

#[derive(Default)]
struct FakeApps {
    running: Vec<RunningApp>,
    installed: Vec<InstalledApp>,
    launches: Vec<(String, bool)>,
    reveals: Vec<String>,
    launched_path: Option<String>,
}

impl AppsOs for FakeApps {
    fn running(&mut self) -> Vec<RunningApp> {
        self.running.clone()
    }

    fn installed(&mut self) -> Vec<InstalledApp> {
        self.installed.clone()
    }

    fn launch(&mut self, bundle: &str, activate: bool) -> Result<u32, Refusal> {
        self.launches.push((bundle.to_owned(), activate));
        Ok(900)
    }

    fn reveal(&mut self, bundle: &str) -> bool {
        self.reveals.push(bundle.to_owned());
        true
    }

    fn process_path(&mut self, _pid: u32) -> Option<String> {
        self.launched_path.clone()
    }
}

fn installed(id: &str, name: &str) -> InstalledApp {
    InstalledApp {
        bundle_id: id.into(),
        name: name.into(),
        path: format!("/Applications/{name}.app"),
    }
}

fn fixture() -> FakeApps {
    FakeApps {
        running: vec![
            RunningApp {
                pid: 70,
                bundle_id: Some("com.apple.TextEdit".into()),
                name: "TextEdit".into(),
                path: Some("/System/Applications/TextEdit.app".into()),
                regular: true,
                has_windows: true,
            },
            RunningApp {
                pid: 71,
                bundle_id: Some("com.example.agent".into()),
                name: "Agent".into(),
                path: None,
                regular: false,
                has_windows: false,
            },
        ],
        installed: vec![
            installed("com.apple.TextEdit", "TextEdit"),
            installed("com.apple.Notes", "Notes"),
            installed("com.apple.Calculator", "Calculator"),
        ],
        ..FakeApps::default()
    }
}

#[test]
fn apps_list_dedupes_by_bundle_id_and_sorts() {
    let apps = list(&mut fixture());
    let rows: Vec<_> = apps
        .iter()
        .map(|a| (a.name.as_str(), a.app_key.as_str(), a.running, a.source))
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                "Calculator",
                "com.apple.Calculator",
                false,
                AppSource::LaunchServices
            ),
            ("Notes", "com.apple.Notes", false, AppSource::LaunchServices),
            ("TextEdit", "com.apple.TextEdit", true, AppSource::Running),
        ],
        "the running record kept, a background agent not listed"
    );
}

#[test]
fn apps_open_returns_a_handle_only_when_the_pid_is_inside_the_bundle() {
    let mut os = fixture();
    os.launched_path = Some("/Applications/Notes.app/Contents/MacOS/Notes".into());
    assert_eq!(
        open(&mut os, "com.apple.Notes", OpenOptions::default(), false),
        Ok(Opened::Launched {
            app_key: "com.apple.Notes".into(),
            pid: Some(900)
        })
    );
    assert_eq!(
        os.launches,
        vec![("/Applications/Notes.app".to_owned(), false)],
        "never activates by default"
    );
    os.launched_path = Some("/Applications/Notes.app.evil/Contents/MacOS/Notes".into());
    assert_eq!(
        open(&mut os, "Notes", OpenOptions::default(), false),
        Ok(Opened::Launched {
            app_key: "com.apple.Notes".into(),
            pid: None
        }),
        "a prefix-sibling path is not inside the bundle"
    );
}

#[test]
fn apps_open_activate_and_reveal_require_the_lease() {
    let mut os = fixture();
    for options in [
        OpenOptions {
            activate: true,
            reveal: false,
        },
        OpenOptions {
            activate: false,
            reveal: true,
        },
    ] {
        assert_eq!(
            open(&mut os, "Notes", options, false),
            Err(Refusal::new(
                EngineCode::ControlRequired,
                Reason::LeaseMissing
            ))
        );
    }
    assert!(
        os.launches.is_empty() && os.reveals.is_empty(),
        "nothing launched or revealed"
    );
    assert_eq!(
        open(
            &mut os,
            "Notes",
            OpenOptions {
                activate: false,
                reveal: true
            },
            true
        ),
        Ok(Opened::Revealed {
            app_key: "com.apple.Notes".into()
        })
    );
    assert!(os.launches.is_empty());
    open(
        &mut os,
        "Notes",
        OpenOptions {
            activate: true,
            reveal: false,
        },
        true,
    )
    .expect("activate under the lease");
    assert_eq!(
        os.launches,
        vec![("/Applications/Notes.app".to_owned(), true)]
    );
}

#[test]
fn apps_open_unknown_key_refused() {
    let mut os = fixture();
    assert_eq!(
        open(
            &mut os,
            "com.example.missing",
            OpenOptions::default(),
            false
        ),
        Err(APP_UNKNOWN)
    );
    assert!(os.launches.is_empty());
}

#[test]
fn running_lists_window_owners_and_windowless_regular_apps() {
    let running = |pid, id: &str, regular, has_windows| RunningApp {
        pid,
        bundle_id: Some(id.into()),
        name: id.into(),
        path: None,
        regular,
        has_windows,
    };
    let mut os = FakeApps {
        running: vec![
            running(80, "com.example.windowless", true, false),
            running(81, "com.example.menubar", false, true),
            running(82, "com.example.daemon", false, false),
        ],
        ..FakeApps::default()
    };
    let keys: Vec<_> = list(&mut os)
        .into_iter()
        .filter(|a| a.running)
        .map(|a| a.app_key)
        .collect();
    assert_eq!(
        keys,
        vec!["com.example.menubar", "com.example.windowless"],
        "running window owners plus regular-policy apps; a windowless background agent is not listed"
    );
}

#[test]
fn installed_scan_finds_nested_bundles_but_never_inside_one() {
    let root = std::env::temp_dir().join(format!("omo-apps-scan-{}", std::process::id()));
    let make = |rel: &str| std::fs::create_dir_all(root.join(rel)).expect("mkdir");
    make("Top.app/Contents/Helpers/Inner.app");
    make("Utilities/Tool.app");
    make("Vendor/Suite/Editor.app");
    make("a/b/c/d/TooDeep.app");
    let mut found: Vec<String> = super::scan::app_bundles(&root)
        .iter()
        .filter_map(|p| p.strip_prefix(&root).ok())
        .map(|p| p.display().to_string())
        .collect();
    found.sort();
    std::fs::remove_dir_all(&root).expect("cleanup");
    assert_eq!(
        found,
        vec!["Top.app", "Utilities/Tool.app", "Vendor/Suite/Editor.app"],
        "vendor subfolders are scanned; a bundle's own helpers and anything past the depth are not"
    );
}
