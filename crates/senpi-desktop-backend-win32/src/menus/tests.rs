//! Portable label, command-id and bound checks.

use super::*;

#[test]
fn native_labels_decode_mnemonics_and_accelerators() {
    for (raw, title, shortcut) in [
        ("&Open...\tCtrl+O", "Open...", Some("Ctrl+O")),
        ("Rock && &Roll", "Rock & Roll", None),
        ("&Über…\t  Alt+Ü  ", "Über…", Some("Alt+Ü")),
        ("Save &\t ", "Save &", None),
    ] {
        assert_eq!(
            native_label(raw),
            (title.into(), shortcut.map(str::to_owned))
        );
    }
}

#[test]
fn native_command_ids_are_never_silently_truncated() {
    assert_eq!(native_message(42, 3, 0).unwrap(), (0x111, 42));
    assert_eq!(native_message(0, 3, 0).unwrap(), (0x111, 0));
    assert_eq!(native_message(65535, 3, 0).unwrap(), (0x111, 65535));
    assert!(native_message(65536, 3, 0).is_err());
    assert!(native_message(u32::MAX, 3, 0).is_err());
    assert_eq!(
        native_message(u32::MAX, 3, NOTIFY_BY_POSITION).unwrap(),
        (0x126, 3)
    );
}

#[test]
fn native_item_count_is_bounded() {
    assert_eq!(native::bounded_count(512).unwrap(), MAX_ITEMS);
    assert!(native::bounded_count(513).is_err());
    assert!(native::bounded_count(-1).is_err());
}
