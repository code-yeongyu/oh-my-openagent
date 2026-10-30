mod common;

use common::{fake_backend, Engine, TWO_DISPLAYS};
use serde_json::{json, Value};

#[test]
fn region_rpc_keeps_the_full_frame_valid_for_later_input() {
    // Given
    let mut engine = Engine::spawn(&[fake_backend(TWO_DISPLAYS)]);
    engine.invoke("session.open", json!({"allowHostRelayOnlyStop": true}));
    engine.invoke("stopPath.start", json!({"chord": "ctrl+alt+shift+escape"}));
    engine.invoke("stopPath.heartbeat", json!({}));
    let full = engine.invoke(
        "capture",
        json!({"target": "101", "caps": {"maxWidth": 32}}),
    );
    let region = json!({"x": 0.0, "y": 0.0, "width": 8.0, "height": 6.0});
    // When
    let zoom = engine.invoke(
        "captureRegion",
        json!({
            "target": "101", "region": region, "frameId": full["result"]["frameId"],
            "caps": {"maxWidth": 8}
        }),
    );
    let moved = engine.invoke(
        "moveMouse",
        json!({
            "target": "101", "x": 16, "y": 12, "frameId": full["result"]["frameId"]
        }),
    );
    // Then
    assert!(zoom.get("error").is_none(), "{zoom}");
    assert_eq!(zoom["result"]["region"], region);
    assert_eq!(zoom["result"]["coordinateWidth"], full["result"]["width"]);
    assert_eq!(zoom["result"]["coordinateHeight"], full["result"]["height"]);
    assert_eq!(zoom["result"]["frameId"], full["result"]["frameId"]);
    assert_eq!(moved["result"], Value::Null, "{moved}");
    assert!(moved.get("error").is_none(), "{moved}");
    assert!(engine.finish().success());
}
