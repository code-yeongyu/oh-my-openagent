//! Ported from oh-my-pi `desktop/applications.rs` tests (0838d2ab44).

use std::path::Path;

use crate::protocol_params::{AppsListParams, AppsOpenParams};
use crate::types::Application;

use super::{application, filter, opens_as_document, resolve_by, route, url_scheme, validate, with_listed_state, Route};

fn app(id: &str, name: &str, path: &str) -> Application {
    Application { id: id.into(), name: name.into(), path: path.into(), running: false, pid: None }
}

fn no_helper(_: &Application) -> bool {
    false
}

fn open(id: &str) -> AppsOpenParams {
    AppsOpenParams { id: id.into(), activate: None, reveal: None, app: None }
}

#[test]
fn identity_precedes_name_and_names_are_case_insensitive() {
    let apps = [app("org.example.Editor", "Edit", "/A.app"), app("other", "org.example.Editor", "/B.app")];
    assert_eq!(resolve_by(&apps, "org.example.Editor", no_helper).unwrap().unwrap().path, "/A.app");
    assert_eq!(resolve_by(&apps, "eDiT", no_helper).unwrap().unwrap().id, "org.example.Editor");
    assert!(resolve_by(&apps, "missing", no_helper).unwrap().is_none());
}

#[test]
fn duplicate_names_and_bundle_id_copies_require_path() {
    let apps = [app("same", "Editor", "/A.app"), app("same", "editor", "/B.app")];
    assert!(resolve_by(&apps, "EDITOR", no_helper).is_err());
    assert!(resolve_by(&apps, "same", no_helper).is_err());
    assert_eq!(resolve_by(&apps, "/B.app", no_helper).unwrap().unwrap().path, "/B.app");
}

#[test]
fn a_name_shared_with_helpers_names_the_regular_app() {
    let helper = app("helper", "Contacts", "/H.app");
    let contacts = app("contacts", "Contacts", "/C.app");
    let is_helper = |app: &Application| app.id == "helper";
    let apps = [helper.clone(), contacts.clone()];
    assert_eq!(resolve_by(&apps, "contacts", is_helper).unwrap().unwrap().path, "/C.app");
    assert!(resolve_by(&apps, "Contacts", |_| true).is_err());
    let apps = [helper, contacts, app("copy", "Contacts", "/D.app")];
    let error = resolve_by(&apps, "Contacts", is_helper).unwrap_err();
    assert!(error.message.contains("/C.app") && error.message.contains("/D.app"), "{}", error.message);
    assert!(!error.message.contains("/H.app"), "{}", error.message);
}

#[test]
fn an_explicit_path_to_a_running_application_keeps_its_running_state() {
    let running = Application { running: true, pid: Some(42), ..app("notes", "Notes", "/N.app") };
    let apps = [app("other", "Other", "/O.app"), running];
    let opened = with_listed_state(&apps, app("notes", "Notes", "/N.app"));
    assert_eq!((opened.running, opened.pid), (true, Some(42)));
    let unlisted = with_listed_state(&apps, app("x", "X", "/X.app"));
    assert_eq!((unlisted.running, unlisted.pid), (false, None));
}

#[test]
fn url_schemes_never_take_a_drive_letter_or_bundle_id() {
    assert_eq!(url_scheme("https://example.com"), Some("https"));
    assert_eq!(
        url_scheme("x-apple.systempreferences:com.apple.Sound-Settings.extension"),
        Some("x-apple.systempreferences")
    );
    assert_eq!(url_scheme(r"C:\Users\me\notes.txt"), None);
    assert_eq!(url_scheme("com.apple.TextEdit"), None);
    assert_eq!(url_scheme("TextEdit"), None);
    assert_eq!(url_scheme("1password:open"), None);
}

#[test]
fn existing_files_and_folders_open_as_documents_on_macos_only() {
    let dir = std::env::temp_dir().join(format!("senpi-desktop-apps-open-{}", std::process::id()));
    let bundle = dir.join("Editor.app");
    std::fs::create_dir_all(&bundle).unwrap();
    let file = dir.join("notes.txt");
    std::fs::write(&file, "x").unwrap();
    let as_document = |path: &Path| opens_as_document(path.to_str().unwrap());
    assert_eq!(as_document(&file), cfg!(target_os = "macos"));
    assert_eq!(as_document(&dir), cfg!(target_os = "macos"));
    assert!(!as_document(&bundle), "an .app bundle stays an application");
    assert!(!as_document(&dir.join("missing.txt")));
    assert!(opens_as_document("https://example.com"));
    assert!(!opens_as_document("com.apple.TextEdit"));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn an_exact_inventory_identity_is_never_shadowed_by_a_url_or_a_file() {
    let dir = std::env::temp_dir().join(format!("senpi-desktop-apps-route-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("com.example.Editor");
    std::fs::write(&file, "x").unwrap();
    let shadowed = file.to_str().unwrap();
    let packaged = r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App";
    let apps = [app("calc", "Calculator", packaged), app(shadowed, "Editor", "/E.app")];
    assert_eq!(route(&apps, &open(packaged)), Route::Application);
    assert_eq!(route(&apps, &open(shadowed)), Route::Application);
    assert_eq!(route(&[], &open(packaged)), Route::Document);
    assert_eq!(route(&[], &open(shadowed)) == Route::Document, cfg!(target_os = "macos"));
    assert_eq!(route(&apps, &open("https://example.com")), Route::Document);
    assert_eq!(route(&apps, &open("Calculator")), Route::Application);
    let reveal = AppsOpenParams { reveal: Some(true), ..open(shadowed) };
    assert_eq!(route(&apps, &reveal), Route::Document);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn reveal_and_app_together_and_empty_identities_are_refused_before_anything_opens() {
    let both = AppsOpenParams { reveal: Some(true), app: Some("TextEdit".into()), ..open("/tmp") };
    let error = validate(&both).unwrap_err();
    assert!(error.message.contains("reveal or app, not both"), "{}", error.message);
    assert!(validate(&open("")).is_err());
    assert!(validate(&open("a\0b")).is_err());
    assert!(validate(&open("TextEdit")).is_ok());
}

#[test]
fn the_listing_filters_by_query_and_running_state_and_sorts_by_name() {
    let apps = vec![
        Application { running: true, ..app("com.apple.TextEdit", "TextEdit", "/System/Applications/TextEdit.app") },
        app("com.apple.Notes", "Notes", "/System/Applications/Notes.app"),
        app("com.apple.calculator", "Calculator", "/System/Applications/Calculator.app"),
    ];
    let names = |apps: Vec<Application>| apps.into_iter().map(|app| app.name).collect::<Vec<_>>();
    assert_eq!(names(filter(apps.clone(), &AppsListParams::default())), ["Calculator", "Notes", "TextEdit"]);
    let query = AppsListParams { query: Some("textEDIT".into()), running_only: None };
    assert_eq!(names(filter(apps.clone(), &query)), ["TextEdit"]);
    let running = AppsListParams { query: None, running_only: Some(true) };
    assert_eq!(names(filter(apps.clone(), &running)), ["TextEdit"]);
    let by_id = AppsListParams { query: Some("apple.not".into()), running_only: None };
    assert_eq!(names(filter(apps, &by_id)), ["Notes"]);
}

#[test]
fn application_reads_an_explicit_path_and_names_a_missing_one() {
    let apps = [app("notes", "Notes", "/N.app")];
    let from_path = |path: &Path| Ok(app("read", "Read", path.to_str().unwrap()));
    assert_eq!(application(&apps, "notes", no_helper, from_path).unwrap().id, "notes");
    assert_eq!(application(&apps, "/Else.app", no_helper, from_path).unwrap().id, "read");
    let error = application(&apps, "Missing", no_helper, from_path).unwrap_err();
    assert!(error.message.contains("apps.list()"), "{}", error.message);
}

#[test]
fn activate_or_reveal_take_the_foreground() {
    assert!(!open("Notes").takes_foreground());
    assert!(AppsOpenParams { activate: Some(true), ..open("Notes") }.takes_foreground());
    assert!(AppsOpenParams { reveal: Some(true), ..open("/tmp") }.takes_foreground());
    assert!(!AppsOpenParams { activate: Some(false), reveal: Some(false), ..open("Notes") }.takes_foreground());
}
