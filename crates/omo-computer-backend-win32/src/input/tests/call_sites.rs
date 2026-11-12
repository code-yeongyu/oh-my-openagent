//! Source guard (acceptance 30, 36): one `SendInput` call site and one `PostMessageW` call site in
//! the whole crate, and no enigo.

fn sources(dir: &std::path::Path, out: &mut Vec<(String, String)>) {
    for entry in std::fs::read_dir(dir).expect("src dir") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "tests") {
                continue;
            }
            sources(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") && !path.ends_with("tests.rs") {
            out.push((
                path.display().to_string(),
                std::fs::read_to_string(&path).expect("source"),
            ));
        }
    }
}

fn calls(needle: &str) -> Vec<String> {
    let mut files = Vec::new();
    sources(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    files
        .iter()
        .flat_map(|(path, text)| {
            text.lines()
                .filter(|line| line.contains(needle) && !line.trim_start().starts_with("//"))
                .map(move |_| path.clone())
        })
        .collect()
}

#[test]
fn single_sendinput_call_site() {
    assert_eq!(calls("SendInput(").len(), 1, "{:?}", calls("SendInput("));
    assert_eq!(
        calls("PostMessageW(").len(),
        1,
        "{:?}",
        calls("PostMessageW(")
    );
    assert!(calls("enigo").is_empty());
}
