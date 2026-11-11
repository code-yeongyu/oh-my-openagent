//! The `Disposition` wire: serde and the schema admit the same seven
//! `(delivery, retry)` pairs and nothing else.

use serde_json::json;

use super::validator::{definition, Validator};
use crate::engine_schema;
use crate::report::Disposition;

const DELIVERIES: [&str; 5] = [
    "not_delivered",
    "delivery_uncertain",
    "delivered_unverified",
    "delivered_verified",
    "unknown",
];
const RETRIES: [&str; 4] = ["safe", "after_user", "unsafe", "unknown"];

#[test]
fn serde_and_schema_admit_exactly_the_seven_pairs() {
    // Given
    let schema = engine_schema();
    let validator = Validator { root: &schema };
    let mut admitted = Vec::new();
    // When every delivery x retry combination is parsed both ways
    for delivery in DELIVERIES {
        for retry in RETRIES {
            let value = json!({"delivery": delivery, "retry": retry});
            let by_serde = serde_json::from_value::<Disposition>(value.clone()).ok();
            let by_schema = validator
                .check(&definition("Disposition"), &value, "disposition")
                .is_ok();
            // Then they agree
            assert_eq!(by_serde.is_some(), by_schema, "{value}");
            admitted.extend(by_serde);
        }
    }
    assert_eq!(admitted.len(), 7);
    for disposition in Disposition::ALL {
        assert!(admitted.contains(&disposition), "{disposition:?}");
        let wire = serde_json::to_value(disposition).unwrap();
        assert_eq!(
            serde_json::from_value::<Disposition>(wire).unwrap(),
            disposition
        );
    }
}

#[test]
fn a_disposition_with_an_extra_member_is_rejected() {
    let schema = engine_schema();
    let validator = Validator { root: &schema };
    let value = json!({"delivery": "not_delivered", "retry": "safe", "legacy": true});
    assert!(serde_json::from_value::<Disposition>(value.clone()).is_err());
    assert!(validator
        .check(&definition("Disposition"), &value, "disposition")
        .is_err());
}
