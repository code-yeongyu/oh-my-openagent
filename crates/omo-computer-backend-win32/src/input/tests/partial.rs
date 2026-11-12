//! A partial `SendInput` releases only the downs it inserted (OMW-18; acceptance 22).

use crate::input::partial::releases_after;
use crate::input::{KeyUnit, VK_SHIFT};

#[test]
fn partial_sendinput_releases_only_inserted_downs() {
    let batch = vec![
        KeyUnit::virtual_key(VK_SHIFT, true),
        KeyUnit::unicode(0x41, true),
        KeyUnit::unicode(0x41, false),
        KeyUnit::virtual_key(VK_SHIFT, false),
    ];
    // Two of four accepted: Shift down and 'A' down went in, so both and only both are released,
    // last-in first-out.
    assert_eq!(
        releases_after(&batch, 2),
        vec![
            KeyUnit::unicode(0x41, false),
            KeyUnit::virtual_key(VK_SHIFT, false)
        ]
    );
    // Three accepted: 'A' is already up, only Shift is released.
    assert_eq!(
        releases_after(&batch, 3),
        vec![KeyUnit::virtual_key(VK_SHIFT, false)]
    );
    // Nothing accepted, or everything: nothing to release.
    assert!(releases_after(&batch, 0).is_empty());
    assert!(releases_after(&batch, 4).is_empty());
}
