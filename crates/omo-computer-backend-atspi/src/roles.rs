//! AT-SPI role names in the outline vocabulary, and the role-dependent rungs of the
//! action-resolution ladder (`d-linux.md` '### Actions').

/// The outline role of an AT-SPI role name; the AT-SPI name stays the native role.
#[must_use]
pub fn outline_role(native: &str) -> String {
    let mapped = match native {
        "push button" | "push button menu" => "button",
        "toggle button" => "togglebutton",
        "check box" | "check menu item" => "checkbox",
        "radio button" | "radio menu item" => "radio",
        "text" | "entry" | "password text" | "editbar" => "textfield",
        "menu item" | "tearoff menu item" => "menuitem",
        "menu bar" => "menubar",
        "label" | "static" | "paragraph" => "text",
        "frame" | "window" => "window",
        "combo box" => "combobox",
        "slider" | "spin button" => "slider",
        "list item" => "listitem",
        "page tab" => "tab",
        "page tab list" => "tablist",
        "document web" | "document frame" => "webarea",
        "image" | "icon" => "image",
        "" => "unknown",
        other => return other.replace(' ', ""),
    };
    mapped.to_owned()
}

/// Roles whose `press` may also resolve to `check` / `uncheck`.
const TOGGLE_ROLES: &[&str] = &[
    "check box",
    "radio button",
    "toggle button",
    "check menu item",
    "radio menu item",
];

/// The command actions `press` resolves to, in the design's order.
const PRESS: &[&str] = &[
    "click",
    "clickancestor",
    "press",
    "activate",
    "invoke",
    "toggle",
    "open",
    "jump",
    "dodefault",
];

fn normalized(action: &str) -> String {
    action
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Whether the action named `action` is a `press` rung for an element of `role`.
#[must_use]
pub fn is_press_rung(role: &str, action: &str) -> bool {
    let name = normalized(action);
    PRESS.contains(&name.as_str())
        || (TOGGLE_ROLES.contains(&role) && matches!(name.as_str(), "check" | "uncheck"))
}

/// Roles whose value is the Text interface's contents.
#[must_use]
pub fn reads_text(role: &str) -> bool {
    matches!(
        role,
        "text" | "entry" | "editbar" | "spin button" | "combo box"
    )
}
