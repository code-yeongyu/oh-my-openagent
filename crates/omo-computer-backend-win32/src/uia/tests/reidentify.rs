use omo_computer_core::error::EngineCode;

use super::fake::element;
use crate::uia::reidentify::reidentify;

#[test]
fn runtime_id_reidentification_zero_and_two() {
    let none = reidentify(Vec::new()).expect_err("0 matches");
    assert_eq!(none.code, EngineCode::StaleRef);
    let two = reidentify(vec![
        element(&[1, 2], "Button", "OK"),
        element(&[1, 2], "Button", "OK"),
    ])
    .expect_err("2 matches");
    assert_eq!(two.code, EngineCode::AmbiguousTarget);
    let one = reidentify(vec![element(&[1, 2], "Button", "OK")]).expect("exactly one");
    assert_eq!(one.runtime_id, vec![1, 2]);
}
