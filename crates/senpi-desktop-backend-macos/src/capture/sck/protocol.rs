//! Wire shapes exchanged with the persistent capture helper: one JSON
//! request per line, one JSON header plus packed premultiplied BGRA bytes per reply.

use serde::{Deserialize, Serialize};

/// One capture target in a batch request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TargetRequest {
    pub kind: &'static str,
    pub id: u32,
    /// Display-only: titles of windows the helper must exclude.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub exclude_window_titles: Vec<String>,
    /// Display-only: window IDs the helper must exclude (cursor helpers).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub exclude_window_ids: Vec<u32>,
}

impl TargetRequest {
    pub(crate) fn window(id: u32) -> Self {
        Self {
            kind: "window",
            id,
            exclude_window_titles: Vec::new(),
            exclude_window_ids: Vec::new(),
        }
    }

    pub(crate) fn display(id: u32, exclude_window_titles: &[String], exclude_window_ids: &[u32]) -> Self {
        Self {
            kind: "display",
            id,
            exclude_window_titles: exclude_window_titles.to_vec(),
            exclude_window_ids: exclude_window_ids.to_vec(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Batch<'a> {
    pub requests: &'a [TargetRequest],
    pub max_pixels: u64,
}

/// Logical-global bounds the helper reports beside each frame.
#[derive(Debug, Clone, Copy, Deserialize)]
pub(crate) struct ReplyBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A reply header: either one frame descriptor or one typed error.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum Reply {
    /// The answer to a warm-up ping: the helper is up and has fetched
    /// shareable content once.
    Ready,
    Frame {
        index: usize,
        width: u32,
        height: u32,
        #[serde(rename = "byteLength")]
        byte_length: usize,
        bounds: ReplyBounds,
        #[serde(default, rename = "isOnScreen")]
        is_on_screen: Option<bool>,
        /// The owning process of a window frame; `0` or absent when unknown.
        #[serde(default)]
        pid: Option<i32>,
    },
    Error {
        code: String,
        error: String,
        #[serde(default)]
        reason: Option<String>,
    },
}

impl ReplyBounds {
    pub(crate) fn valid(self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width > 0.0
            && self.height > 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serializes_the_helper_wire_shape() {
        let targets = [
            TargetRequest::window(42),
            TargetRequest::display(1, &["OmO HUD".to_owned()], &[]),
        ];
        let batch = Batch {
            requests: &targets,
            max_pixels: 8_294_400,
        };
        let value = serde_json::to_value(batch).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "requests": [
                    {"kind": "window", "id": 42},
                    {"kind": "display", "id": 1, "excludeWindowTitles": ["OmO HUD"]},
                ],
                "maxPixels": 8_294_400u64,
            })
        );
    }

    #[test]
    fn reply_parses_frame_error_and_unavailable() {
        let frame: Reply = serde_json::from_str(
            r#"{"kind":"frame","index":0,"width":4,"height":2,"byteLength":32,"isOnScreen":true,"bounds":{"x":1.0,"y":2.0,"width":4.0,"height":2.0}}"#,
        )
        .unwrap();
        let Reply::Frame {
            index,
            byte_length,
            is_on_screen,
            bounds,
            ..
        } = frame
        else {
            panic!("expected a frame reply");
        };
        assert_eq!((index, byte_length, is_on_screen), (0, 32, Some(true)));
        assert!(bounds.valid());

        let error: Reply =
            serde_json::from_str(r#"{"kind":"error","code":"PermissionDenied","error":"denied"}"#).unwrap();
        let Reply::Error { code, reason, .. } = error else {
            panic!("expected an error reply");
        };
        assert_eq!((code.as_str(), reason), ("PermissionDenied", None));

        let unavailable: Reply = serde_json::from_str(
            r#"{"kind":"error","code":"CaptureUnavailable","reason":"minimized","error":"minimized"}"#,
        )
        .unwrap();
        let Reply::Error { code, reason, .. } = unavailable else {
            panic!("expected an error reply");
        };
        assert_eq!((code.as_str(), reason.as_deref()), ("CaptureUnavailable", Some("minimized")));
    }
}
