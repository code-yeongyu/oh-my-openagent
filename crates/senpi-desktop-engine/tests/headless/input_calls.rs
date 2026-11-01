//! The mutating calls every input-path test drives, with parseable params.

use serde_json::{json, Value};

use crate::WINDOW;

/// Every mutating method (pointer, keyboard, window, menu, AX, clipboard
/// write) with parseable params.
pub fn input_calls() -> [(&'static str, Value); 14] {
    let at = json!({"target": "desktop", "x": 10.0, "y": 10.0});
    [
        ("click", at.clone()),
        ("moveMouse", at),
        (
            "drag",
            json!({"target": "desktop", "path": [{"x": 1.0, "y": 1.0}, {"x": 5.0, "y": 5.0}]}),
        ),
        (
            "scroll",
            json!({"target": "desktop", "x": 10.0, "y": 10.0, "dx": 0.0, "dy": 3.0}),
        ),
        ("typeText", json!({"target": WINDOW, "text": "hi"})),
        ("keyChord", json!({"target": WINDOW, "keys": ["ctrl", "a"]})),
        ("raiseWindow", json!({"windowId": WINDOW})),
        ("menus.select", json!({"windowId": WINDOW, "path": ["File", "Save"]})),
        ("ax.perform", json!({"ref": "e1", "action": "press"})),
        ("ax.setValue", json!({"ref": "e1", "value": "hi"})),
        ("ax.focus", json!({"ref": "e1"})),
        ("ax.click", json!({"ref": "e1"})),
        ("ax.typeText", json!({"ref": "e1", "text": "hi"})),
        ("clipboard.write", json!({"text": "hi"})),
    ]
}
