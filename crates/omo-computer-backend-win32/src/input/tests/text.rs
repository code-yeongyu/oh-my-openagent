//! Typed text never depends on the keyboard layout (d-windows.md '## Input', Typing).

use crate::input::text::{background_chars, foreground_batches};
use crate::input::{KeyUnit, Posted, VK_RETURN, WM_CHAR, WM_KEYDOWN, WM_KEYUP};

#[test]
fn foreground_text_is_keyeventf_unicode_pairs_with_no_layout_key() {
    let batches = foreground_batches("a\u{D55C}");
    assert_eq!(batches.len(), 2, "one batch per code point");
    for (batch, unit) in batches.iter().zip([0x61u16, 0xD55C]) {
        assert_eq!(
            batch,
            &vec![KeyUnit::unicode(unit, true), KeyUnit::unicode(unit, false)]
        );
    }
    // No unit names a virtual key: nothing reads the active layout.
    assert!(batches
        .iter()
        .flatten()
        .all(|unit| unit.vk == 0 && unit.unicode));
}

#[test]
fn surrogate_pair_is_one_batch_and_newline_is_scan_coded_return() {
    let batches = foreground_batches("\u{1F600}\n");
    assert_eq!(
        batches[0].len(),
        4,
        "both halves of the pair go in one SendInput batch"
    );
    assert_eq!(batches[0][0], KeyUnit::unicode(0xD83D, true));
    assert_eq!(batches[0][2], KeyUnit::unicode(0xDE00, true));
    assert_eq!(
        batches[1],
        vec![
            KeyUnit::scan_coded(VK_RETURN, true),
            KeyUnit::scan_coded(VK_RETURN, false)
        ]
    );
}

#[test]
fn wm_char_per_utf16_unit() {
    let posted = background_chars("A\u{1F600}");
    assert_eq!(
        posted.iter().map(|p| (p.msg, p.wparam)).collect::<Vec<_>>(),
        vec![(WM_CHAR, 0x41), (WM_CHAR, 0xD83D), (WM_CHAR, 0xDE00)],
        "one WM_CHAR per UTF-16 unit"
    );
    // \r, \n and \r\n are each ONE Return press, never a WM_CHAR per byte.
    for text in ["x\ny", "x\ry", "x\r\ny"] {
        let posted: Vec<Posted> = background_chars(text);
        let returns: Vec<_> = posted
            .iter()
            .filter(|p| p.wparam == usize::from(VK_RETURN))
            .collect();
        assert_eq!(
            returns.iter().map(|p| p.msg).collect::<Vec<_>>(),
            vec![WM_KEYDOWN, WM_KEYUP],
            "{text:?}"
        );
        assert_eq!(posted.len(), 4, "{text:?}");
    }
}
