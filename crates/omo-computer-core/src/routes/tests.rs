use std::collections::BTreeMap;

use serde_json::json;

use super::*;

#[test]
fn route_table_loads_and_rejects_unknown_class() {
    let table = RouteTable::seed().expect("the shipped seed loads");
    assert_eq!(table.class_of(RouteOs::Macos, "org.blenderfoundation.blender"), Some(ToolkitClass::CanvasGl));
    assert_eq!(table.class_of(RouteOs::Windows, "SALFRAME"), Some(ToolkitClass::PointerHw));
    let bad = json!({ "routes": [
        { "os": "x11", "keyKind": "wm_class", "key": "Blender", "class": "canvas_gl", "cite": "x" },
        { "os": "x11", "keyKind": "wm_class", "key": "Godot", "class": "webgl2", "cite": "x" }
    ] });
    assert_eq!(RouteTable::load(&bad), Err(RouteTableInvalid { pointer: "/routes/1/class".to_owned() }));
}

#[test]
fn the_table_loads_only_exact_keys_on_every_os() {
    for (os, key) in [("macos", "com.example.*"), ("x11", " Blender"), ("windows", "Chrome?"), ("windows", "")] {
        let doc = json!({ "routes": [{ "os": os, "keyKind": "k", "key": key, "class": "canvas_gl", "cite": "x" }] });
        assert_eq!(
            RouteTable::load(&doc),
            Err(RouteTableInvalid { pointer: "/routes/0/key".to_owned() }),
            "{os} {key:?}"
        );
    }
    let mut table = RouteTable::seed().expect("seed");
    let user = BTreeMap::from([("Blend*".to_owned(), ToolkitClass::CanvasGl)]);
    assert_eq!(table.extend(RouteOs::X11, &user), Err(RouteTableInvalid { pointer: "/toolkit_routes/Blend*".to_owned() }));
}

#[test]
fn unknown_app_takes_default_route() {
    let table = RouteTable::seed().expect("seed");
    assert_eq!(table.class_of(RouteOs::X11, "Eog"), None, "unlisted: no class, the default route");
    assert_eq!(table.class_of(RouteOs::X11, "blender"), None, "never a case fold");
    assert_eq!(table.class_of(RouteOs::X11, "Blend"), None, "never a substring");
}

#[test]
fn a_user_key_extends_the_table_exactly() {
    let mut table = RouteTable::seed().expect("seed");
    let user = BTreeMap::from([("Krita".to_owned(), ToolkitClass::CanvasGl)]);
    table.extend(RouteOs::X11, &user).expect("an exact user key");
    assert_eq!(table.class_of(RouteOs::X11, "Krita"), Some(ToolkitClass::CanvasGl));
}

#[test]
fn chromium_electron_membership_is_anchored_and_refuses_lookalikes() {
    for member in ["Chrome_WidgetWin_1", "Chrome_WidgetWin_0", "CefBrowserWindow", "Chrome_RenderWidgetHostHWND"] {
        assert!(is_chromium_electron(RouteOs::Windows, member), "{member}");
    }
    for lookalike in ["Chrome_WidgetWin_", "ChromeLikeWidgetWin", "Widget_Chrome_Host", "MyCefBrowser"] {
        assert!(!is_chromium_electron(RouteOs::Windows, lookalike), "{lookalike}");
    }
    for member in ["Google-chrome", "Chromium", "firefox", "Navigator", "Electron"] {
        assert!(is_chromium_electron(RouteOs::X11, member), "{member}");
    }
    assert!(!is_chromium_electron(RouteOs::X11, "google-chrome"), "whole and exact, never lower-cased");
    assert!(is_chromium_electron(RouteOs::Macos, "com.google.Chrome"));
    assert!(is_chromium_electron(RouteOs::Macos, "com.google.Chrome.canary"));
    assert!(!is_chromium_electron(RouteOs::Macos, "com.google.Chromeish"), "a dot, not any suffix");
    assert!(!is_chromium_electron(RouteOs::Macos, "com.apple.archiveutility"));
}
