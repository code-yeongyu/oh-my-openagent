use super::{excluded_window_ids, WINDOW_TITLE};
use crate::focus::WindowInfo;

#[test]
fn window_server_title_excludes_helpers_even_while_they_are_visible() {
    let helper = |pid, on_screen| WindowInfo {
        pid, window_number: pid, layer: 1000, on_screen, cursor_overlay: true,
    };
    assert!(!WINDOW_TITLE.is_empty());
    // Neither process belongs to the capturing session. Each is independently excluded.
    assert_eq!(excluded_window_ids(&[helper(77, true), helper(88, false)]).unwrap(), [77, 88]);
    assert_eq!(excluded_window_ids(&[helper(77, false), helper(88, true)]).unwrap(), [77, 88]);
    assert_eq!(excluded_window_ids(&[helper(77, false), helper(88, false)]).unwrap(), [77, 88]);
    assert!(excluded_window_ids(&[WindowInfo { cursor_overlay: false, ..helper(77, true) }]).unwrap().is_empty());
    assert!(excluded_window_ids(&[WindowInfo { window_number: 0, ..helper(77, true) }]).is_err());
}
