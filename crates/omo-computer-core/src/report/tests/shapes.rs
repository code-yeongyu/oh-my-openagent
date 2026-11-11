//! Wire shapes: every invalid shape is refused, every valid control is accepted, and an
//! accepted report's disposition is a member of `ALL`.

use super::shape_cases::{invalid_shapes, valid_shapes};
use super::wire_check;
use crate::report::Disposition;

fn run(only_c3: bool) -> usize {
    let (mut refused, mut dispositions) = (0, 0);
    for (c3, label, report, context) in invalid_shapes() {
        if only_c3 && !c3 {
            continue;
        }
        let checked = wire_check(&report, context);
        println!("REJECT {label}: {:?}", checked.as_ref().err());
        assert!(checked.is_err(), "accepted an invalid shape: {label}");
        if label.starts_with("disposition ") {
            let why = checked.err().unwrap_or_default();
            assert!(
                why.contains("is not one of the seven valid pairs"),
                "{label} was refused for something other than its disposition: {why}"
            );
            dispositions += 1;
        }
        refused += 1;
    }
    assert_eq!(
        dispositions,
        if only_c3 { 0 } else { 13 },
        "the 13 invalid pairs, each refused for its disposition"
    );
    for (label, report, context) in valid_shapes() {
        let checked = wire_check(&report, context);
        println!("ACCEPT {label}: {:?}", checked.as_ref().err());
        let disposition = checked
            .unwrap_or_else(|error| panic!("refused a valid shape {label}: {error}"))
            .disposition();
        assert!(
            Disposition::ALL.contains(&disposition),
            "{label}: disposition outside ALL"
        );
    }
    refused
}

#[test]
fn disposition_wire_shapes() {
    let refused = run(true);
    println!("{refused} design-row C3 shapes refused");
    assert!(refused >= 20, "the C3 list shrank: {refused}");
}

#[test]
fn action_report_wire_validation() {
    let refused = run(false);
    println!("{refused} invalid shapes refused");
    assert!(refused >= 40, "fewer than 40 invalid shapes: {refused}");
}
