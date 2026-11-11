//! The reply of every exec verb.
//!
//! In a null-mode session the reply is `null`, byte-identical with v1. In an object-mode
//! session it is the `ActionReport` of the result contract; parsing a reply runs the wire
//! validation every verb shares, and `ActionReport::validate` adds the per-verb rules.

use std::borrow::Cow;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};

use crate::report::ActionReport;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExecReply(pub Option<ActionReport>);

impl JsonSchema for ExecReply {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("ExecReply")
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        let report = generator.subschema_for::<ActionReport>();
        json_schema!({
            "description": "null in a null-mode session; the ActionReport in an object-mode session.",
            "anyOf": [{ "type": "null" }, report]
        })
    }
}
