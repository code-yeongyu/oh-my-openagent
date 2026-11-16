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
            },
            RunningApp {
                pid: 71,
                bundle_id: Some("com.example.agent".into()),
                name: "Agent".into(),
                path: None,
                regular: false,
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
