//! D3: every event the engine posts carries its tag, so the user-input watch
//! never counts it as the user's. Production code creates events only through
//! the tagged constructors in `src/input/cgevent.rs`. This source guard runs
//! on every platform; only `#[cfg(test)]` modules may create untagged events
//! (to stand in for the user).

mod lex;
mod scan;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use lex::tokens;
use scan::{bypasses, module_tree};

const CONSTRUCTORS: &str = "src/input/cgevent.rs";

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// `a/b.rs` on every platform (Windows joins with `\\`).
fn slash_path(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn found(source: &str) -> Vec<&'static str> {
    bypasses(&tokens(source))
}

#[test]
fn every_form_of_untagged_event_creation_is_caught() {
    let cases = [
        ("CGEvent::new*", "let e = CGEvent::new(source.clone());"),
        (
            "CGEvent::new*",
            "CGEvent::new_keyboard_event(source.clone(), 0, true)",
        ),
        (
            "CGEvent::new*",
            "CGEvent\n    ::\n    new_mouse_event(source.clone(), kind, point, button)",
        ),
        (
            "CGEvent::new*",
            "core_graphics::event::CGEvent::new_scroll_event(s, u, 2, y, x, 0)",
        ),
        ("CGEvent::new*", "<CGEvent>::new(source)"),
        (
            "raw CGEventCreate* FFI",
            "unsafe { CGEventCreateKeyboardEvent(source, 0, true) }",
        ),
        (
            "raw CGEventCreate* FFI",
            "let copy = unsafe { CGEventCreateCopy(event) };",
        ),
        (
            "raw CGEventCreate* FFI",
            "fn CGEventCreateMouseEvent(\n    s: Ref, t: u32, p: CGPoint, b: u32,\n) -> Ref;",
        ),
        (
            "CGEvent imported under another name",
            "use core_graphics::event::CGEvent as Ev;",
        ),
        (
            "CGEvent imported under another name",
            "use core_graphics::event::{CGEventFlags, CGEvent\n    as Ev};",
        ),
        (
            "type alias of CGEvent",
            "type Ev = core_graphics::event::CGEvent;",
        ),
        (
            "type alias of CGEvent",
            "pub(crate) type Ev =\n    CGEvent;",
        ),
    ];
    for (form, source) in cases {
        assert_eq!(found(source), [form], "{source}");
    }
}

#[test]
fn tagged_constructors_comments_strings_and_plain_uses_are_not_bypasses() {
    for source in [
        "let event = mouse_event(&source, kind, point, button)?;",
        "// CGEvent::new and CGEventCreateCopy would bypass the tag",
        "/* CGEvent\n::new */ let x = 1;",
        "let s = \"CGEvent::new(source)\";",
        "let s = r#\"CGEventCreateCopy(e)\"#;",
        "fn post(event: &CGEvent) -> CGEventFlags { CGEventFlags::CGEventFlagNull }",
        "use core_graphics::event::CGEvent;",
        "let c = '\\''; let d = 'x'; fn f<'a>(e: &'a CGEvent) {}",
    ] {
        assert!(found(source).is_empty(), "{source}");
    }
}

fn virtual_tree(files: &[(&str, &str)]) -> impl Fn(&Path) -> Option<String> {
    let files: BTreeMap<PathBuf, String> = files
        .iter()
        .map(|(path, source)| (PathBuf::from(path), (*source).to_owned()))
        .collect();
    move |path: &Path| files.get(path).cloned()
}

#[test]
fn only_modules_declared_under_cfg_test_are_test_code_whatever_their_name() {
    let read = virtual_tree(&[
        ("src/lib.rs", "mod live; mod probe_tests; #[cfg(test)] mod checks; #[cfg(test)]\n#[path = \"x/y.rs\"] mod moved;\nmod a { fn f() {} } #[cfg(test)] mod inline { fn g() { CGEvent::new(s); } }"),
        ("src/live.rs", "fn live() { CGEvent::new(s); }"),
        ("src/probe_tests.rs", "fn p() { CGEventCreateCopy(e); }"),
        ("src/checks.rs", "fn t() { CGEvent::new(s); } mod deeper;"),
        ("src/checks/deeper.rs", "fn d() { CGEvent::new(s); }"),
        ("src/x/y.rs", "fn m() { CGEvent::new(s); }"),
    ]);
    let tree = module_tree(Path::new("src/lib.rs"), &read);
    let kinds: BTreeMap<String, (bool, Vec<&str>)> = tree
        .iter()
        .map(|module| {
            (
                slash_path(&module.path),
                (module.test, bypasses(&module.production_tokens)),
            )
        })
        .collect();
    assert_eq!(
        kinds["src/lib.rs"],
        (false, vec![]),
        "an inline cfg(test) body is test code"
    );
    assert_eq!(kinds["src/live.rs"], (false, vec!["CGEvent::new*"]));
    assert_eq!(
        kinds["src/probe_tests.rs"],
        (false, vec!["raw CGEventCreate* FFI"])
    );
    assert!(kinds["src/checks.rs"].0 && kinds["src/checks/deeper.rs"].0 && kinds["src/x/y.rs"].0);
    assert_eq!(kinds.len(), 6);
}

#[test]
fn no_production_source_creates_an_untagged_event() {
    let root = crate_dir();
    let read = |path: &Path| std::fs::read_to_string(root.join(path)).ok();
    let tree = module_tree(Path::new("src/lib.rs"), &read);
    let mut reached: Vec<PathBuf> = tree.iter().map(|module| module.path.clone()).collect();
    reached.sort();
    let mut on_disk = Vec::new();
    let mut dirs = vec![root.join("src")];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).expect("source dir") {
            let path = entry.expect("source entry").path();
            if path.is_dir() {
                dirs.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                on_disk.push(
                    path.strip_prefix(&root)
                        .expect("under the crate")
                        .to_path_buf(),
                );
            }
        }
    }
    on_disk.sort();
    assert_eq!(
        reached, on_disk,
        "the module walk must reach every source file"
    );
    let untagged: Vec<String> = tree
        .iter()
        .filter(|module| !module.test && module.path != Path::new(CONSTRUCTORS))
        .flat_map(|module| {
            bypasses(&module.production_tokens)
                .into_iter()
                .map(|form| format!("{}: {form}", slash_path(&module.path)))
        })
        .collect();
    assert!(
        untagged.is_empty(),
        "events created outside {CONSTRUCTORS} carry no engine tag: {untagged:?}"
    );
}
