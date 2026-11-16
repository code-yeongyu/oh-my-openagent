//! UIA control type ids (`UIA_*ControlTypeId`, 50000-50040) as the role names the outline uses.

const NAMES: [&str; 41] = [
    "Button",
    "Calendar",
    "CheckBox",
    "ComboBox",
    "Edit",
    "Hyperlink",
    "Image",
    "ListItem",
    "List",
    "Menu",
    "MenuBar",
    "MenuItem",
    "ProgressBar",
    "RadioButton",
    "ScrollBar",
    "Slider",
    "Spinner",
    "StatusBar",
    "Tab",
    "TabItem",
    "Text",
    "ToolBar",
    "ToolTip",
    "Tree",
    "TreeItem",
    "Custom",
    "Group",
    "Thumb",
    "DataGrid",
    "DataItem",
    "Document",
    "SplitButton",
    "Window",
    "Pane",
    "Header",
    "HeaderItem",
    "Table",
    "TitleBar",
    "Separator",
    "SemanticZoom",
    "AppBar",
];

/// The role name of control type `id`; `Custom` for an id outside the table.
#[must_use]
pub fn name_of(id: i32) -> &'static str {
    id.checked_sub(50_000)
        .and_then(|index| usize::try_from(index).ok())
        .and_then(|index| NAMES.get(index))
        .copied()
        .unwrap_or("Custom")
}
