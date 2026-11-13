use serde_json::json;

use super::*;

fn node(title: &str, children: Vec<MenuNode>) -> MenuNode {
    MenuNode {
        title: title.to_owned(),
        enabled: true,
        children,
        ..MenuNode::default()
    }
}

fn path(steps: &[&str]) -> Vec<String> {
    steps.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn a_menu_read_carries_all_six_fields() {
    let mut save = node("Save", Vec::new());
    save.accelerator = Some("Cmd+S".to_owned());
    save.checked = true;
    let (items, truncated) = list(&[node("File", vec![save])], &[], MenuBounds::X11);
    assert!(!truncated);
    let wire = serde_json::to_value(&items[1]).expect("item");
    assert_eq!(
        wire,
        json!({ "label": "Save", "enabled": true, "checked": true, "accelerator": "Cmd+S",
            "submenu": false, "path": ["File", "Save"], "observation": { "untrustedText": true } })
    );
    assert_eq!(serde_json::to_value(&items[0]).expect("item")["submenu"], json!(true));
}

#[test]
fn menu_select_by_exact_label_only() {
    let tree = [node("File", vec![node("Save As…", Vec::new()), node("Save", Vec::new())])];
    assert_eq!(find_exact(&tree, &path(&["File", "Save"])).map(|n| n.title.as_str()), Ok("Save"));
    assert_eq!(find_exact(&tree, &path(&["File", "Sav"])), Err(Refusal::bare(EngineCode::StaleRef)), "never a substring");
    assert_eq!(find_exact(&tree, &path(&["file", "save"])), Err(Refusal::bare(EngineCode::StaleRef)), "never a case fold");
    let twins = [node("Edit", Vec::new()), node("Edit", Vec::new())];
    assert_eq!(find_exact(&twins, &path(&["Edit"])), Err(Refusal::bare(EngineCode::AmbiguousTarget)));
}

#[test]
fn menu_relabelled_between_listing_and_select_is_not_activated() {
    let listed = [node("File", vec![node("Close", Vec::new()), node("Quit", Vec::new())])];
    assert!(prove(&listed, &path(&["File", "Close"])).is_ok());
    let relabelled = [node("File", vec![node("Close Window", Vec::new()), node("Quit", Vec::new())])];
    assert_eq!(prove(&relabelled, &path(&["File", "Close"])), Err(Refusal::bare(EngineCode::StaleRef)));
    let mut disabled = node("Close", Vec::new());
    disabled.enabled = false;
    assert_eq!(prove(&[node("File", vec![disabled])], &path(&["File", "Close"])), Err(Refusal::bare(EngineCode::StaleRef)));
}

#[test]
fn listings_stop_at_the_per_os_bounds() {
    let wide: Vec<MenuNode> = (0..600).map(|i| node(&format!("item {i}"), Vec::new())).collect();
    let (items, truncated) = list(&wide, &[], MenuBounds::WINDOWS);
    assert_eq!((items.len(), truncated), (512, true));
    let mut deep = node("leaf", Vec::new());
    for depth in (0..33).rev() {
        deep = node(&format!("level {depth}"), vec![deep]);
    }
    let (items, truncated) = list(&[deep], &[], MenuBounds::X11);
    assert_eq!((items.len(), truncated), (32, true));
    let (items, _) = list(&[node("", Vec::new()), node("View", Vec::new())], &[], MenuBounds::X11);
    assert_eq!(items.len(), 1, "a separator is not an item");
}
