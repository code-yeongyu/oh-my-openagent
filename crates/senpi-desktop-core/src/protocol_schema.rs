//! `engine_schema()`: the JSON Schema (draft-07) of the whole engine
//! protocol, committed as `schema/engine.schema.json` and printed by the
//! engine's `--schema`.

use schemars::generate::SchemaSettings;
use schemars::transform::RecursiveTransform;
use schemars::{Schema, SchemaGenerator};
use serde_json::{json, Map, Value};

use crate::error::ErrorCode;
use crate::methods::{method_schemas, Exposure, Method, Notification};
use crate::protocol::{
    rpc_error_code, RpcNotification, RpcRequest, RpcResponse, ABI, ERROR_CODES, INVALID_PARAMS,
    INVALID_REQUEST, METHOD_NOT_FOUND, PARSE_ERROR, PROTOCOL_VERSION,
};

/// The protocol schema: `methods` (effect, hostOnly, testOnly, params and
/// result schemas per method), `notifications`, the numeric `errors` table,
/// and every wire type under `definitions` (incl. the `Method` enum).
#[must_use]
pub fn engine_schema() -> Value {
    let settings = SchemaSettings::draft07().with_transform(RecursiveTransform(close_object));
    let mut generator = SchemaGenerator::new(settings);
    let methods: Map<String, Value> = method_schemas(&mut generator)
        .into_iter()
        .map(|(spec, params, result)| {
            let entry = json!({
                "effect": spec.effect,
                "hostOnly": spec.exposure == Exposure::HostOnly,
                "testOnly": spec.exposure == Exposure::TestOnly,
                "params": finish(&mut generator, params),
                "result": finish(&mut generator, result),
            });
            (spec.name.to_owned(), entry)
        })
        .collect();
    let notifications: Map<String, Value> = Notification::ALL
        .into_iter()
        .map(|notification| {
            let params = notification.params_schema(&mut generator);
            let params = finish(&mut generator, params);
            (notification.name().to_owned(), json!({ "params": params }))
        })
        .collect();
    let errors: Map<String, Value> = ERROR_CODES
        .into_iter()
        .map(|code| (code.as_str().to_owned(), json!(rpc_error_code(code))))
        .collect();
    // Registered for their `definitions` entries; the returned `$ref`s are not needed.
    generator.subschema_for::<Method>();
    generator.subschema_for::<ErrorCode>();
    generator.subschema_for::<RpcRequest>();
    generator.subschema_for::<RpcResponse>();
    generator.subschema_for::<RpcNotification>();
    json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "senpi-desktop engine protocol",
        "protocolVersion": PROTOCOL_VERSION,
        "abi": ABI,
        "methods": methods,
        "notifications": notifications,
        "errors": errors,
        "standardErrors": {
            "parseError": PARSE_ERROR,
            "invalidRequest": INVALID_REQUEST,
            "methodNotFound": METHOD_NOT_FOUND,
            "invalidParams": INVALID_PARAMS,
        },
        "definitions": generator.take_definitions(true),
    })
}

/// The wire is closed: an object schema rejects members it does not name.
fn close_object(schema: &mut Schema) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    if object.get("type") == Some(&json!("object")) && !object.contains_key("additionalProperties") {
        object.insert("additionalProperties".to_owned(), Value::Bool(false));
    }
}

/// Applies the generator's transforms (draft-07 rewrites, `close_object`)
/// to an inline schema; `take_definitions(true)` does the same for
/// `definitions`.
fn finish(generator: &mut SchemaGenerator, mut schema: Schema) -> Schema {
    for transform in generator.transforms_mut() {
        transform.transform(&mut schema);
    }
    schema
}
