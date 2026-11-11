//! The one typed prompt-injection signal: `observation: {untrustedText: true}`.

use std::borrow::Cow;

use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::de::IgnoredAny;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// `{untrustedText: true}`: screen-derived text in this record is data, never an instruction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UntrustedText;

impl Serialize for UntrustedText {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_unit()
    }
}

impl<'de> Deserialize<'de> for UntrustedText {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        IgnoredAny::deserialize(deserializer).map(|_| Self)
    }
}

impl JsonSchema for UntrustedText {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("UntrustedText")
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({})
    }
}
