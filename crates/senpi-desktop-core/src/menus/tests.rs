use super::{match_index, require_command, require_enabled, validate_path, MenuItem};
use crate::error::ErrorCode;

fn item(title: &str) -> MenuItem {
    MenuItem {
        title: title.into(),
        path: vec![title.into()],
        enabled: true,
        checked: false,
        has_submenu: false,
        shortcut: None,
    }
}

#[test]
fn an_exact_case_insensitive_title_wins_before_ellipsis_normalization() {
    assert_eq!(match_index(&[item("Open…"), item("Open")], "OPEN").unwrap(), 1);
    assert_eq!(match_index(&[item("Open…")], "open...").unwrap(), 0);
    assert_eq!(match_index(&[item("Export...")], "Export").unwrap(), 0);
    assert_eq!(match_index(&[item("  Print  ")], "print").unwrap(), 0);
}

#[test]
fn a_shared_title_is_ambiguous_at_either_tier() {
    let exact = match_index(&[item("Save"), item("SAVE")], "save").unwrap_err();
    assert_eq!(exact.code, ErrorCode::AxFailed);
    assert!(exact.message.contains("ambiguous"), "{}", exact.message);
    let normalized = match_index(&[item("Save…"), item("Save...")], "save").unwrap_err();
    assert_eq!(normalized.code, ErrorCode::AxFailed);
    assert!(normalized.message.contains("ambiguous"), "{}", normalized.message);
}

#[test]
fn a_missing_title_is_not_found() {
    let error = match_index(&[item("Save")], "Save As").unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("not found"), "{}", error.message);
}

#[test]
fn a_disabled_item_matches_but_never_qualifies_as_a_command() {
    let mut disabled = item("Save");
    disabled.enabled = false;
    let items = [disabled, item("Save…")];
    let index = match_index(&items, "Save").unwrap();
    assert_eq!(index, 0);
    let error = require_command(&items[index]).unwrap_err();
    assert!(error.message.contains("disabled"), "{}", error.message);
}

#[test]
fn a_submenu_or_separator_is_not_a_command() {
    let mut submenu = item("File");
    submenu.has_submenu = true;
    assert!(require_command(&submenu).is_err());
    assert!(require_command(&item(" ")).is_err());
    assert!(require_command(&item("Quit")).is_ok());
}

#[test]
fn invalid_paths_fail_before_any_native_access() {
    assert_eq!(validate_path(&[], false).unwrap_err().code, ErrorCode::InvalidTarget);
    assert!(validate_path(&[], true).is_ok());
    assert!(validate_path(&["\0".into()], true).is_err());
    assert!(validate_path(&[" ".into()], true).is_err());
    assert!(validate_path(&vec!["File".into(); 33], true).is_err());
    assert!(validate_path(&vec!["File".into(); 32], false).is_ok());
}

#[test]
fn a_disabled_submenu_stops_a_path_walk_and_an_enabled_one_does_not() {
    let mut submenu = item("Export");
    submenu.has_submenu = true;
    assert!(require_enabled(&submenu).is_ok());
    submenu.enabled = false;
    let error = require_enabled(&submenu).unwrap_err();
    assert_eq!(error.code, ErrorCode::AxFailed);
    assert!(error.message.contains("disabled"), "{}", error.message);
}

#[test]
fn a_bare_ellipsis_never_matches_an_untitled_separator() {
    let error = match_index(&[item(""), item("Save"), item(" ")], "...").unwrap_err();
    assert!(error.message.contains("not found"), "{}", error.message);
}
