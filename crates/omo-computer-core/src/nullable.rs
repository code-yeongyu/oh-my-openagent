//! `Option<Option<T>>` for a member that is absent, `null` or a value, each with its own meaning.
//! Use with `#[serde(default, skip_serializing_if = "Option::is_none", with = "crate::nullable")]`.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[allow(
    clippy::ref_option,
    reason = "serde's `with` passes the field by reference"
)]
pub fn serialize<T: Serialize, S: Serializer>(
    value: &Option<Option<T>>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Some(inner) => inner.serialize(serializer),
        None => serializer.serialize_none(),
    }
}

pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}
