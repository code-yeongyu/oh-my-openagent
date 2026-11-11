//! The reply of every exec verb.
//!
//! In a null-mode session the reply is `null`, byte-identical with v1. In an object-mode
//! session it is the `ActionReport` object of the result contract, whose members the
//! report module declares; this type is the method table's one name for that reply.

use std::borrow::Cow;

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ExecReply(pub Option<Map<String, Value>>);

impl JsonSchema for ExecReply {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("ExecReply")
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "description": "null in a null-mode session; the ActionReport object in an object-mode session.",
            "type": ["object", "null"]
        })
    }
}
