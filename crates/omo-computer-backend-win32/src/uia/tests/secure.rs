use omo_computer_core::ax::Slice;

use super::fake::FakeUia;
use crate::uia::client::UiaHost;
use crate::uia::reader::UiaReader;

fn password_focused() -> FakeUia {
    let mut source = FakeUia::winforms();
    source.focused = Some(vec![42, 3]);
    source
}

fn children(reader: &mut UiaReader<FakeUia>) -> Vec<omo_computer_core::ax::NodeRead> {
    let root = reader.root_of("4660").expect("root");
    let Slice::Read(children) = reader.read_children(root.node.handle.expect("handle"), 0, 250)
    else {
        panic!("children answered");
    };
    children
}

#[test]
fn password_value_is_withheld() {
    let mut reader = UiaReader::new(FakeUia::winforms());
    let children = children(&mut reader);
    let password = children
        .iter()
        .find(|n| n.title.as_deref() == Some("Password"))
        .expect("password box");
    assert!(password.secure, "IsPassword is the secure classification");
    assert_eq!(password.value, None, "the value never leaves the reader");
    let text = children
        .iter()
        .find(|n| n.title.as_deref() == Some("Name"))
        .expect("text box");
    assert!(!text.secure);
    assert_eq!(text.value.as_deref(), Some("hello"));
}

/// The backend's half of AC-62: the focus reads secure (so the session admits the keystrokes and
/// withholds what was typed) and the value read-back the report would carry is never the secret.
#[test]
fn typing_into_a_password_box_is_admitted_by_keystrokes_and_reports_no_value() {
    let mut host = UiaHost::new(Box::new(|| Ok(password_focused())));
    assert_eq!(
        host.secure_focus(None),
        Some(true),
        "a password box has focus"
    );
    assert_eq!(
        host.value_readback("4660", &[42, 3]),
        None,
        "no value read back to report"
    );
    assert_eq!(
        host.value_readback("4660", &[42, 2]).as_deref(),
        Some("hello")
    );
}

#[test]
fn paste_and_clipboard_read_on_a_password_focus_are_refused_secure_focus() {
    let mut host = UiaHost::new(Box::new(|| Ok(password_focused())));
    assert_eq!(
        host.secure_focus(Some("4660")),
        Some(true),
        "the clipboard gate refuses on this answer"
    );
    let mut plain = FakeUia::winforms();
    plain.focused = Some(vec![42, 2]);
    let mut host = UiaHost::new(Box::new(move || Ok(std::mem::take(&mut plain))));
    assert_eq!(
        host.secure_focus(None),
        Some(false),
        "a plain text box: paste and clipboard read go ahead"
    );
    let mut nothing = UiaHost::new(Box::new(|| Ok(FakeUia::winforms())));
    assert_eq!(
        nothing.secure_focus(None),
        None,
        "no focus read: unknown, which the gate refuses"
    );
}

/// Review M1 of #13837: the focused password box is a child window of the named top-level window,
/// so the secure-focus read compares the window it lives in, not its own child HWND.
#[test]
fn secure_focus_on_a_named_window_matches_a_password_box_with_its_own_child_hwnd() {
    let mut host = UiaHost::new(Box::new(|| Ok(password_focused())));
    assert_eq!(
        host.secure_focus(Some("4660")),
        Some(true),
        "the box's top-level window is 0x1234"
    );
    assert_eq!(
        host.secure_focus(Some("1")),
        Some(false),
        "focus is in another window"
    );
}

/// Review L2 of #13837: a password box's value never stays in the reader's kept elements.
#[test]
fn a_password_value_is_not_kept_by_the_reader() {
    let mut reader = UiaReader::new(FakeUia::winforms());
    let read = children(&mut reader);
    let password = read.iter().find(|n| n.secure).expect("password node");
    let kept = reader
        .element(password.handle.expect("handle"))
        .expect("kept");
    assert_eq!(kept.value, None, "the secret is dropped at the read");
}

/// Review MEDIUM of #13837 at 44cdbb2103: the read-back searches the target's top-level window,
/// never the whole desktop; a window it cannot name gets no search at all.
#[test]
fn value_readback_searches_the_target_window_and_never_the_desktop() {
    let mut host = UiaHost::new(Box::new(|| Ok(FakeUia::winforms())));
    assert_eq!(
        host.value_readback("4660", &[42, 2]).as_deref(),
        Some("hello"),
        "found in the target's window"
    );
    assert_eq!(
        host.value_readback("1", &[42, 2]),
        None,
        "not in another window"
    );
    assert_eq!(host.value_readback("0", &[42, 2]), None, "no window named");
    assert_eq!(
        host.value_readback("not-a-window", &[42, 2]),
        None,
        "no window named"
    );
    let calls = &host.reader().expect("reader").source().calls;
    assert_eq!(
        calls,
        &["find_runtime_id 4660", "find_runtime_id 1"],
        "no search without a window"
    );
}
