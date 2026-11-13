//! Ref identity is the element's `RuntimeId`: one stable `NativeObject` per id, so the session's
//! re-identification (0 -> StaleRef, 2+ -> AmbiguousTarget, row 18) compares UIA elements by it.

use crate::uia::identity::native_object;

#[test]
fn runtime_id_maps_to_one_stable_native_object() {
    let a = [42, 0x0001_0203, 7, 9];
    assert_eq!(
        native_object(&a),
        native_object(&a.clone()),
        "the same id twice is the same object"
    );
    assert_ne!(
        native_object(&a),
        native_object(&[42, 0x0001_0203, 7, 10]),
        "one differing part"
    );
    assert_ne!(
        native_object(&[1, 2]),
        native_object(&[2, 1]),
        "order matters"
    );
    assert_ne!(
        native_object(&[1, 2]),
        native_object(&[1, 2, 0]),
        "length matters"
    );
    assert_ne!(native_object(&[-1]), native_object(&[1]), "sign matters");
}
