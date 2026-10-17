//! Native accessibility roles -> the cross-platform role vocabulary.

/// Maps a raw `AX*` macOS accessibility role.
pub fn normalize_role_macos(native: &str) -> String {
    match native {
        "AXTextArea" => "textarea",
        "AXTextField" => "textfield",
        "AXPopUpButton" => "popupbutton",
        "AXRadioButton" => "radio",
        "AXCheckBox" => "checkbox",
        "AXStaticText" => "statictext",
        "AXScrollArea" => "scrollarea",
        "AXTabGroup" => "tabgroup",
        "AXWebArea" => "webarea",
        "AXRow" => "row",
        "AXCell" => "cell",
        "AXOutline" => "outline",
        _ => native.strip_prefix("AX").unwrap_or(native),
    }
    .to_ascii_lowercase()
}

/// Maps a Windows UI Automation control type name.
pub fn normalize_role_uia(native: &str) -> String {
    match native {
        "Edit" => "textfield",
        "Document" => "textarea",
        "Text" => "statictext",
        "Hyperlink" => "link",
        "Pane" => "group",
        "TabItem" => "tab",
        "Tab" => "tabgroup",
        "DataItem" => "listitem",
        "DataGrid" => "table",
        "SplitButton" => "popupbutton",
        other => return other.to_ascii_lowercase(),
    }
    .to_string()
}

/// Maps an AT-SPI role name; `multiline` splits text entries into textarea.
pub fn normalize_role_atspi(native: &str, multiline: bool) -> String {
    match native.to_ascii_lowercase().as_str() {
        "push button" | "toggle button" => "button".into(),
        "entry" | "text" if multiline => "textarea".into(),
        "entry" | "text" => "textfield".into(),
        "label" => "statictext".into(),
        "page tab" => "tab".into(),
        "page tab list" => "tabgroup".into(),
        "table cell" => "cell".into(),
        "tree" => "outline".into(),
        "tree item" => "outlineitem".into(),
        "frame" | "dialog" => "window".into(),
        other => other.replace(' ', ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_tables() {
        for (native, role) in [
            ("AXTextArea", "textarea"),
            ("AXTextField", "textfield"),
            ("AXPopUpButton", "popupbutton"),
            ("AXRadioButton", "radio"),
            ("AXCheckBox", "checkbox"),
            ("AXStaticText", "statictext"),
            ("AXScrollArea", "scrollarea"),
            ("AXTabGroup", "tabgroup"),
            ("AXWebArea", "webarea"),
            ("AXRow", "row"),
            ("AXCell", "cell"),
            ("AXOutline", "outline"),
            ("AXButton", "button"),
        ] {
            assert_eq!(normalize_role_macos(native), role);
        }
        for (native, role) in [
            ("Edit", "textfield"),
            ("Document", "textarea"),
            ("Text", "statictext"),
            ("Hyperlink", "link"),
            ("Pane", "group"),
            ("TabItem", "tab"),
            ("Tab", "tabgroup"),
            ("DataItem", "listitem"),
            ("DataGrid", "table"),
            ("SplitButton", "popupbutton"),
            ("Button", "button"),
        ] {
            assert_eq!(normalize_role_uia(native), role);
        }
        for (native, multiline, role) in [
            ("push button", false, "button"),
            ("toggle button", false, "button"),
            ("entry", false, "textfield"),
            ("text", true, "textarea"),
            ("label", false, "statictext"),
            ("page tab", false, "tab"),
            ("page tab list", false, "tabgroup"),
            ("table cell", false, "cell"),
            ("tree", false, "outline"),
            ("tree item", false, "outlineitem"),
            ("frame", false, "window"),
            ("dialog", false, "window"),
            ("list item", false, "listitem"),
        ] {
            assert_eq!(normalize_role_atspi(native, multiline), role);
        }
    }
}
