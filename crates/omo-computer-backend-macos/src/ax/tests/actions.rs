//! AX actions, the value-verb ladder, menus without focus moves, and the source guards.

use omo_computer_core::ax::{walk, AxHandle, AxReader, Limits};
use omo_computer_core::backend::{Delivered, Refusal, Semantic};
use omo_computer_core::error::{EngineCode, Reason};

use super::kit::{node, FakeAx};
use crate::ax::seam::{Attributes, AxValue};
use crate::ax::MacAx;

const ONE: Delivered = Delivered { count: 1, of: 1 };

fn field() -> (MacAx<FakeAx>, AxHandle) {
    let mut fake = FakeAx::default();
    fake.window(7, 70, 1_000, 100);
    fake.tree(100, 2, 1);
    let mut ax = MacAx::new(fake);
    let root = ax.root("7").expect("root");
    let limits = Limits::of(&ax);
    let handle = walk(&mut ax, root.node, &limits).nodes[1]
        .read
        .handle
        .expect("handle");
    (ax, handle)
}

#[test]
fn press_falls_back_through_the_ax_ladder() {
    let (mut ax, handle) = field();
    ax.server_mut().unsupported.push((101, "AXPress".into()));
    assert_eq!(ax.perform(handle, &Semantic("press".into())), Ok(ONE));
    assert_eq!(ax.server().performed, vec![(101, "AXConfirm".to_owned())]);
    assert_eq!(
        ax.perform(handle, &Semantic("teleport".into())),
        Err(Refusal::new(
            EngineCode::AxUnsupported,
            Reason::PerformUnsupported
        ))
    );
}

#[test]
fn set_value_and_select_text_write_the_attribute_and_read_back() {
    let (mut ax, handle) = field();
    assert_eq!(ax.set_value(handle, "hello"), Ok(ONE));
    assert_eq!(ax.select_text(handle, 1, 3), Ok(ONE));
    let writes: Vec<_> = ax
        .server()
        .writes
        .iter()
        .map(|(e, a, v)| (*e, a.clone(), v.clone()))
        .collect();
    assert_eq!(
        writes,
        vec![
            (101, "AXValue".to_owned(), AxValue::Text("hello".into())),
            (
                101,
                "AXSelectedTextRange".to_owned(),
                AxValue::Range {
                    location: 1,
                    length: 3
                }
            ),
        ]
    );
}

#[test]
fn menus_list_and_select_without_moving_focus() {
    let mut fake = FakeAx::default();
    fake.window(7, 70, 1_000, 100);
    fake.menu_bars.insert(70, 500);
    fake.add(500, node("AXMenuBar"), vec![501]);
    fake.add(
        501,
        Attributes {
            title: Some("File".into()),
            ..node("AXMenuBarItem")
        },
        vec![502],
    );
    fake.add(502, node("AXMenu"), vec![503, 504]);
    fake.add(
        503,
        Attributes {
            title: Some("Open".into()),
            enabled: Some(true),
            ..node("AXMenuItem")
        },
        Vec::new(),
    );
    fake.add(
        504,
        Attributes {
            title: Some("Close".into()),
            enabled: Some(false),
            ..node("AXMenuItem")
        },
        Vec::new(),
    );
    let mut ax = MacAx::new(fake);
    let items: Vec<_> = ax
        .menu(70)
        .expect("menu")
        .into_iter()
        .map(|i| (i.path.join(">"), i.enabled))
        .collect();
    assert_eq!(
        items,
        vec![
            ("File>Open".to_owned(), true),
            ("File>Close".to_owned(), false)
        ]
    );
    assert_eq!(ax.select_menu(70, &["File", "Open"]), Ok(ONE));
    assert_eq!(
        ax.server().performed,
        vec![(503, "AXPress".to_owned())],
        "only the leaf is pressed"
    );
    assert!(ax.server().writes.is_empty(), "focus is never written");
    assert!(ax.select_menu(70, &["File", "Missing"]).is_err());
}

fn ax_sources() -> Vec<(String, String)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/ax");
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("src/ax") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs")
                && !path.ends_with("tests/actions.rs")
            {
                out.push((
                    path.display().to_string(),
                    std::fs::read_to_string(&path).expect("read"),
                ));
            }
        }
    }
    out
}

#[test]
fn source_guard_no_enhanced_user_interface_and_no_sleep() {
    let enhanced = ["AXEnhanced", "UserInterface"].concat();
    let sleep = ["thread::", "sleep"].concat();
    for (path, text) in ax_sources() {
        assert!(
            !text.contains(&enhanced),
            "{path} names the attribute that reflows the app"
        );
        assert!(!text.contains(&sleep), "{path} sleeps");
    }
}
