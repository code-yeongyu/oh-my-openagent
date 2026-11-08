//! Combined observation over the real engine's stdio boundary.
mod common;

use common::{error_code, fake_backend, Engine, TWO_DISPLAYS};
use serde_json::json;

#[test]
fn observation_returns_matching_capture_and_resolvable_window_refs() {
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    let opened = engine.invoke("session.open", json!({}));
    assert!(opened.get("error").is_none(), "{opened}");
    let observed = engine.invoke(
        "observe",
        json!({"target": "101", "caps": {"maxWidth": 32}, "ax": {"maxNodes": 1}}),
    );
    assert!(observed.get("error").is_none(), "{observed}");
    let result = &observed["result"];
    assert_eq!(result["target"], "101");
    assert_eq!(result["coordinateWidth"], 32);
    assert_eq!(result["coordinateHeight"], 24);
    assert_eq!(result["nodeCount"], 1);
    assert_eq!(result["truncated"], true);
    assert!(result["data"].as_str().is_some_and(|data| !data.is_empty()));
    assert!(result["frameId"].as_str().is_some_and(|id| !id.is_empty()));
    let reference = result["ax"]
        .as_str()
        .unwrap()
        .split("[ref=")
        .nth(1)
        .unwrap()
        .split(']')
        .next()
        .unwrap();
    let node = engine.invoke("ax.node", json!({"ref": reference}));
    assert!(node.get("error").is_none(), "{node}");
    assert_eq!(node["result"]["ref"], reference);
    assert_eq!(node["result"]["role"], "window");
    let refused = engine.invoke("observe", json!({"target": "desktop"}));
    assert_eq!(error_code(&refused), "InvalidTarget");
    assert!(engine.finish().success());
}
