//! The compositor-fed keymap: re-read on a layout change, resolved in the active group only
//! (d-linux.md 'Typing'; acceptance 81).

use omo_computer_core::capabilities::CompositorName;
use omo_computer_core::error::{EngineCode, Reason};

use super::support::{send, text, Rig, FR, SETTLE, US, US_FR};
use crate::fake::Mode;

/// evdev codes of the two keys whose glyphs differ between US and French.
const KEY_Q: u32 = 16;
const KEY_A: u32 = 30;

fn pressed(rig: &Rig) -> Vec<u32> {
    rig.eis.log().keys.iter().filter(|(_, down)| *down).map(|(code, _)| *code).collect()
}

#[test]
fn layout_changed_rereads_keymap() {
    let rig = Rig::new(US, Mode::Serve);
    let mut backend = rig.socket_backend(CompositorName::Mutter);
    assert!(send(&mut backend, &text("a")).is_ok());
    assert_eq!(pressed(&rig), vec![KEY_A], "US: 'a' is the key labelled A");
    assert_eq!(backend.input_report().layouts, vec!["English (US)".to_owned()], "the keymap the compositor fed");

    rig.eis.change_keymap(FR);
    assert!(rig.eis.wait_for(SETTLE, |log| log.keymaps_fed == 2));
    assert!(send(&mut backend, &text("a")).is_ok());
    assert_eq!(pressed(&rig), vec![KEY_A, KEY_Q], "French: 'a' is now the key labelled Q");
    assert_eq!(backend.input_report().layouts, vec!["French".to_owned()], "re-read after the layout change");
}

#[test]
fn unresolvable_grapheme_names_active_group() {
    let rig = Rig::new(US_FR, Mode::Serve);
    let mut backend = rig.socket_backend(CompositorName::Mutter);
    let refusal = send(&mut backend, &text("é")).expect_err("no US key types é");
    assert_eq!(refusal.code, EngineCode::InvalidKey);
    assert_eq!(refusal.reason, Some(Reason::Unresolvable));
    let data = refusal.wire_data();
    assert_eq!(data["group"], "English (US)", "names the active group: {data}");
    assert_eq!(data["nextCall"], "paste");
    assert!(pressed(&rig).is_empty(), "no key borrowed from the French group");

    // The group change arrives asynchronously, in the keyboard's modifiers event.
    rig.eis.set_group(1);
    let mut typed = false;
    for _ in 0..50 {
        if send(&mut backend, &text("é")).is_ok() {
            typed = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    assert!(typed, "the French group is active: é resolves there");
    assert_eq!(backend.input_report().active_group.as_deref(), Some("French"));
}

#[test]
fn unresolvable_grapheme_sends_no_libei_event_and_a_following_paste_reads_back() {
    let rig = Rig::new(US, Mode::Serve);
    let mut backend = rig.socket_backend(CompositorName::Mutter);
    backend.set_clipboard(Box::new(crate::fake::FakeClipboard::default()));
    let refusal = send(&mut backend, &text("aé")).expect_err("é has no key in the US group");
    assert_eq!(refusal.reason, Some(Reason::Unresolvable));
    let log = rig.eis.log();
    assert!(log.keys.is_empty() && log.frames == 0, "no libei event, not even the resolvable 'a': {log:?}");
    use omo_computer_core::backend::Backend;
    assert!(backend.clipboard_write("aé").is_ok(), "the paste route takes the text");
    match backend.clipboard_read() {
        Ok(omo_computer_core::clipboard::ClipboardRead::Text(read)) => assert_eq!(read.as_deref(), Some("aé"), "read back"),
        other => panic!("the clipboard reads back the text: {other:?}"),
    }
    assert!(rig.eis.log().keys.is_empty(), "the paste typed nothing either");
}
