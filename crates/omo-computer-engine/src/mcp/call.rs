//! `tools/call` result shaping, as the v1 corpus case 10 reads it: a null result is one text
//! block `null`; an object adds `structuredContent`; an inline capture becomes an image block
//! plus its metadata; an engine error is a tool result with `isError:true` carrying the engine
//! error object unchanged as text.

use serde_json::{json, Map, Value};

use crate::router::WireError;

#[must_use]
pub fn tool_result(outcome: &Result<Value, WireError>) -> Value {
    match outcome {
        Err(error) => json!({ "content": [text(&error.to_value())], "isError": true }),
        Ok(result) => shaped(result),
    }
}

fn shaped(result: &Value) -> Value {
    let Some(object) = result.as_object() else {
        return json!({ "content": [text(result)] });
    };
    let (Some(data), Some(mime)) = (
        object.get("data").and_then(Value::as_str),
        object.get("mimeType").and_then(Value::as_str),
    ) else {
        return json!({ "content": [text(result)], "structuredContent": result });
    };
    let image = json!({ "type": "image", "data": data, "mimeType": mime });
    let metadata: Map<String, Value> = object
        .iter()
        .filter(|(key, _)| key.as_str() != "data")
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let metadata = Value::Object(metadata);
    json!({ "content": [image, text(&metadata)], "structuredContent": metadata })
}

fn text(value: &Value) -> Value {
    json!({ "type": "text", "text": value.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_null_result_is_the_text_null_and_an_error_is_marked() {
        assert_eq!(tool_result(&Ok(Value::Null)), json!({"content": [{"type": "text", "text": "null"}]}));
        let error = WireError::rejected("unknown");
        assert_eq!(tool_result(&Err(error))["isError"], json!(true));
    }

    #[test]
    fn an_inline_capture_splits_into_image_and_metadata() {
        let shaped = tool_result(&Ok(json!({"mode": "inline-png", "data": "AAA", "mimeType": "image/png", "width": 1})));
        assert_eq!(shaped["content"][0], json!({"type": "image", "data": "AAA", "mimeType": "image/png"}));
        assert_eq!(shaped["structuredContent"], json!({"mode": "inline-png", "mimeType": "image/png", "width": 1}));
    }
}
