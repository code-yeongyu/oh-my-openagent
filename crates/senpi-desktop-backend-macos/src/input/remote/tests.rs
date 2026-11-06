use std::fs::File;
use std::path::{Path, PathBuf};

use senpi_desktop_core::error::ErrorCode;
use senpi_desktop_core::types::DesktopWindow;

use super::*;

const KIT: &str = "/System/Library/PrivateFrameworks/ScreenSharingKit.framework/Versions/A/ScreenSharingKit";
const VNC: &str = "/System/Library/PrivateFrameworks/ScreenSharing.framework/Versions/A/ScreenSharing";
const APPKIT: &str = "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit";

/// A thin 64-bit Mach-O for `cpu` whose load commands are a UUID, then
/// alternately strong and weak links to `dylibs`.
fn macho(cpu: u32, dylibs: &[&str]) -> Vec<u8> {
    let mut commands = [0x1b_u32, 24].map(u32::to_le_bytes).concat();
    commands.resize(24, 0);
    for (index, name) in dylibs.iter().enumerate() {
        let kind = if index % 2 == 0 { DYLIB_COMMANDS[0] } else { DYLIB_COMMANDS[1] };
        let size = (24 + name.len() + 1).next_multiple_of(8);
        let start = commands.len();
        commands.extend([kind, u32::try_from(size).unwrap(), 24].map(u32::to_le_bytes).concat());
        commands.resize(start + 24, 0);
        commands.extend(name.as_bytes());
        commands.resize(start + size, 0);
    }
    let count = u32::try_from(dylibs.len()).unwrap() + 1;
    let mut file = [MH_MAGIC_64, cpu, 0, 2, count, u32::try_from(commands.len()).unwrap(), 0, 0].map(u32::to_le_bytes).concat();
    file.extend(commands);
    file
}

/// A universal binary holding `slices` at 4 KiB-aligned offsets.
fn universal(slices: &[(u32, Vec<u8>)]) -> Vec<u8> {
    let mut file = [FAT_MAGIC, u32::try_from(slices.len()).unwrap()].map(u32::to_be_bytes).concat();
    let mut offset = 4096_u32;
    for (cpu, slice) in slices {
        let length = u32::try_from(slice.len()).unwrap();
        file.extend([*cpu, 0, offset, length, 12].map(u32::to_be_bytes).concat());
        offset += length.next_multiple_of(4096);
    }
    for (_, slice) in slices {
        file.resize(file.len().next_multiple_of(4096), 0);
        file.extend(slice);
    }
    file
}

fn classify(file: Vec<u8>) -> Option<RemoteScreen> {
    remote_screen_linkage(&linked_dylibs(&mut std::io::Cursor::new(file))?)
}

fn window() -> DesktopWindow {
    DesktopWindow {
        id: "101".to_owned(),
        title: "Office Mac".to_owned(),
        app: "Screen Sharing".to_owned(),
        pid: Some(4242),
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        focused: false,
        is_on_screen: None,
        elevated: None,
    }
}

/// A layout that types lowercase ASCII bare, uppercase with Shift, and `@` with Option.
fn ascii_layout(character: char) -> Option<Keystroke> {
    match character {
        'a'..='z' => Some(Keystroke { code: u16::from(character as u8 - b'a'), shift: false, option: false }),
        'A'..='Z' => Some(Keystroke { code: u16::from(character.to_ascii_lowercase() as u8 - b'a'), shift: true, option: false }),
        '@' => Some(Keystroke { code: 19, shift: false, option: true }),
        ' ' => Some(Keystroke { code: 49, shift: false, option: false }),
        '\r' | '\n' => Some(Keystroke { code: 36, shift: false, option: false }),
        _ => None,
    }
}

#[test]
fn remote_screens_are_recognised_by_the_screen_sharing_framework_they_link() {
    let native = NATIVE_CPU_TYPE;
    let mirror = ["@rpath/ScreenContinuityUI.framework/Versions/A/ScreenContinuityUI", KIT];
    assert_eq!(classify(macho(native, &mirror)), Some(RemoteScreen::HidReports));
    assert_eq!(classify(macho(native, &[APPKIT, VNC])), Some(RemoteScreen::KeyEvents));
    assert_eq!(classify(macho(native, &[APPKIT])), None);
    assert_eq!(classify(macho(native, &["/Library/Frameworks/MyScreenSharing.framework/A"])), None);
}

#[test]
fn universal_binaries_are_read_from_this_cpus_slice() {
    let other = if NATIVE_CPU_TYPE == 0x0100_000c { 0x0100_0007 } else { 0x0100_000c };
    let file = universal(&[(other, macho(other, &[APPKIT])), (NATIVE_CPU_TYPE, macho(NATIVE_CPU_TYPE, &[KIT]))]);
    assert_eq!(classify(file), Some(RemoteScreen::HidReports));
    let mut truncated = macho(NATIVE_CPU_TYPE, &[KIT]);
    truncated.truncate(truncated.len() - 16);
    assert_eq!(linked_dylibs(&mut std::io::Cursor::new(truncated)), None);
}

#[test]
fn apple_clients_are_remote_screens_even_when_their_executable_is_unreadable() {
    let unreadable = || None;
    assert_eq!(classify_remote_screen(Some("com.apple.ScreenSharing"), unreadable), Some(RemoteScreen::KeyEvents));
    assert_eq!(classify_remote_screen(Some("com.apple.ScreenContinuity"), unreadable), Some(RemoteScreen::HidReports));
    assert_eq!(classify_remote_screen(Some("com.example.Viewer"), unreadable), None);
    assert_eq!(classify_remote_screen(Some("com.example.Viewer"), || Some(RemoteScreen::HidReports)), Some(RemoteScreen::HidReports));
}

#[test]
fn each_process_executable_is_read_once() {
    let cache = LinkageCache::default();
    let reads = std::cell::Cell::new(0);
    let read = |_: &Path| {
        reads.set(reads.get() + 1);
        Some(vec![KIT.as_bytes().to_vec()])
    };
    let viewer = PathBuf::from("/Applications/Viewer.app/Contents/MacOS/Viewer");
    assert_eq!(cached_linkage(&cache, 7, viewer.clone(), read), Some(RemoteScreen::HidReports));
    let again = cached_linkage(&cache, 7, viewer.clone(), |_| panic!("read again"));
    assert_eq!(again, Some(RemoteScreen::HidReports));
    // A reused pid running another executable is read afresh.
    let other = cached_linkage(&cache, 7, PathBuf::from("/bin/ls"), |_| Some(vec![APPKIT.as_bytes().to_vec()]));
    assert_eq!(other, None);
    // An executable that cannot be read is read again on the next event.
    assert_eq!(cached_linkage(&cache, 8, viewer.clone(), |_| None), None);
    assert_eq!(cached_linkage(&cache, 8, viewer, read), Some(RemoteScreen::HidReports));
    assert_eq!(reads.get(), 2);
}

#[test]
fn a_full_linkage_cache_starts_over_and_reads_dropped_processes_again() {
    let cache = LinkageCache::default();
    let reads = std::cell::Cell::new(0);
    let read = |_: &Path| {
        reads.set(reads.get() + 1);
        Some(vec![KIT.as_bytes().to_vec()])
    };
    let viewer = PathBuf::from("/Applications/Viewer.app/Contents/MacOS/Viewer");
    let last = libc::pid_t::try_from(MAX_CACHED_LINKAGES).unwrap();
    for pid in 0..=last {
        assert_eq!(cached_linkage(&cache, pid, viewer.clone(), read), Some(RemoteScreen::HidReports));
    }
    assert_eq!(reads.get(), MAX_CACHED_LINKAGES + 1);
    // The process read after the cache filled is still cached.
    let kept = cached_linkage(&cache, last, viewer.clone(), |_| panic!("read again"));
    assert_eq!(kept, Some(RemoteScreen::HidReports));
    // One dropped when it started over is read again, with the same answer.
    assert_eq!(cached_linkage(&cache, 0, viewer, read), Some(RemoteScreen::HidReports));
    assert_eq!(reads.get(), MAX_CACHED_LINKAGES + 2);
}

#[test]
fn this_test_binary_links_system_libraries_but_no_screen_sharing_framework() {
    let pid = libc::pid_t::try_from(std::process::id()).unwrap();
    let mut executable = File::open(executable_path(pid).unwrap()).unwrap();
    let dylibs = linked_dylibs(&mut executable).unwrap();
    assert!(dylibs.iter().any(|dylib| dylib.starts_with(b"/usr/lib/libSystem")), "{dylibs:?}");
    assert_eq!(remote_screen(pid), None);
}

#[test]
fn every_character_is_mapped_before_anything_is_typed_and_cr_lf_is_one_return() {
    let keys = typed_keys(&window(), "ab\r\nC", ascii_layout).unwrap();
    assert_eq!(keys.iter().map(|key| (key.stroke.code, key.stroke.shift, key.text)).collect::<Vec<_>>(), [(0, false, "a"), (1, false, "b"), (36, false, "\r\n"), (2, true, "C")]);
    // One untypable character refuses the whole text, naming each once, before any key.
    let refused = typed_keys(&window(), "a😀b😀#", ascii_layout).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidKey);
    assert!(refused.message.contains("types 😀 #; nothing was typed"), "{}", refused.message);
}

#[test]
fn a_layout_without_unicode_data_refuses_before_typing() {
    let refused = remote_layout(&window(), || Ok(None::<fn(char) -> Option<Keystroke>>)).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InputFailed);
    assert!(refused.message.contains("nothing was sent"), "{}", refused.message);
    let layout = remote_layout(&window(), || Ok(Some(ascii_layout))).unwrap();
    assert_eq!(layout('a').map(|stroke| stroke.code), Some(0));
}

#[test]
fn text_that_needs_shift_or_option_is_listed_once_for_the_background_refusal() {
    let keys = typed_keys(&window(), "aA@A", ascii_layout).unwrap();
    assert_eq!(modified_text(&keys), ["A", "@"]);
    assert!(modified_text(&typed_keys(&window(), "abc", ascii_layout).unwrap()).is_empty());
    let refusal = keyboard_modifiers_refusal(&window(), "type A @");
    assert_eq!(refusal.code, ErrorCode::BackgroundUnavailable);
    assert!(refusal.message.ends_with("nothing was sent"), "{}", refusal.message);
}

#[test]
fn bare_transitions_hold_shift_and_option_only_while_a_key_needs_them() {
    let keys = typed_keys(&window(), "aAB@b", ascii_layout).unwrap();
    assert_eq!(
        bare_transitions(&keys),
        [
            (0, true), (0, false),
            (SHIFT_CODE, true), (0, true), (0, false), (1, true), (1, false),
            (SHIFT_CODE, false), (OPTION_CODE, true), (19, true), (19, false),
            (OPTION_CODE, false), (1, true), (1, false),
        ]
    );
    // A trailing modifier is released after the last key.
    let keys = typed_keys(&window(), "A", ascii_layout).unwrap();
    assert_eq!(bare_transitions(&keys).last(), Some(&(SHIFT_CODE, false)));
}

#[test]
fn a_device_that_samples_hid_reports_gets_the_report_gap() {
    assert_eq!(key_gap(RemoteScreen::KeyEvents), KEY_GAP);
    assert_eq!(key_gap(RemoteScreen::HidReports), REPORT_KEY_GAP);
    assert!(REPORT_KEY_GAP > KEY_GAP);
}

#[test]
fn a_held_physical_modifier_refuses_before_the_first_key_and_reports_sent_keys_after() {
    let window = window();
    let held = std::cell::Cell::new(0_u64);
    let mut check = physical_modifier_check(&window, || held.get());
    assert!(check().is_ok());
    assert!(check().is_ok());
    held.set(0x0002_0000);
    let after = check().unwrap_err();
    assert_eq!(after.code, ErrorCode::InputFailed);
    assert!(after.message.contains("2 key press(es) sent before this may already have landed"), "{}", after.message);
    let mut fresh = physical_modifier_check(&window, || 0x0001_0000);
    let before = fresh().unwrap_err();
    assert_eq!(before.code, ErrorCode::BackgroundUnavailable);
    assert!(before.message.contains("nothing was sent"), "{}", before.message);
    assert!(holds_modifier(0x0001_0000) && !holds_modifier(0x0000_0100));
}
