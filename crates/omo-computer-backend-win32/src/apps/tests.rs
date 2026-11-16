use super::{compose, open_handle, resolve_aumid, App};

fn app(name: &str, path: Option<&str>, aumid: Option<&str>) -> App {
    App { name: name.to_owned(), path: path.map(str::to_owned), aumid: aumid.map(str::to_owned) }
}

#[test]
fn apps_list_composes_three_sources_and_resolves_an_aumid() {
    let notepad = app("Notepad", Some(r"C:\Windows\System32\notepad.exe"), None);
    let start = [notepad.clone()];
    let running = [notepad.clone(), app("Tool", Some(r"C:\Tools\tool.exe"), None)];
    let packaged = [app("Calculator", None, Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"))];
    let list = compose(&start, &running, &packaged);
    assert_eq!(list.len(), 3, "one entry per app: {list:?}");
    let calc = resolve_aumid(&list, "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App").expect("by AUMID");
    assert_eq!(calc.name, "Calculator");
}

#[test]
fn apps_open_returns_a_handle_only_after_path_identity_is_proven() {
    let listed = app("Tool", Some(r"C:\Tools\tool.exe"), None);
    assert_eq!(open_handle(&listed, 42, r"C:\Tools\tool.exe"), Some(42));
    assert_eq!(open_handle(&listed, 43, r"C:\Users\x\Downloads\tool.exe"), None, "a same-named binary elsewhere");
}
