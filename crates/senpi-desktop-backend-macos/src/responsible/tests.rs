use super::*;

#[test]
fn resolves_self_without_replacing_it_with_the_parent() {
    let identity = resolve_with(
        41,
        Some,
        |pid| { assert_eq!(pid, 41); Some(PathBuf::from("/tmp/engine")) },
        |_| None,
    ).unwrap();
    assert_eq!(identity.pid, 41);
    assert_eq!(identity.executable, Path::new("/tmp/engine"));
    assert!(identity.bundle_id.is_none());
}

#[test]
fn resolves_app_path_and_bundle_using_the_responsible_pid() {
    let identity = resolve_with(
        41,
        |_| Some(42),
        |pid| {
            assert_eq!(pid, 42);
            Some(PathBuf::from("/Applications/QA.app/Contents/MacOS/QA"))
        },
        |path| {
            assert_eq!(path, Path::new("/Applications/QA.app/Contents/MacOS/QA"));
            Some("org.example.qa".to_owned())
        },
    ).unwrap();
    assert_eq!(identity.pid, 42);
    assert_eq!(identity.bundle_id.as_deref(), Some("org.example.qa"));
}

#[test]
fn unresolved_responsibility_does_not_guess_a_path() {
    assert!(resolve_with(41, |_| None, |_| panic!("path lookup"), |_| panic!("bundle lookup")).is_none());
}

#[test]
fn unresolved_path_does_not_guess_an_identity() {
    assert!(resolve_with(41, |_| Some(42), |_| None, |_| panic!("bundle lookup")).is_none());
}

fn app_with_info_plist(identifier_entry: &str) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let contents = dir.path().join("QA.app/Contents");
    std::fs::create_dir_all(contents.join("MacOS")).unwrap();
    std::fs::write(contents.join("Info.plist"), format!(
        r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key>{identifier_entry}</dict></plist>"#
    )).unwrap();
    let executable = contents.join("MacOS/QA");
    (dir, executable)
}

#[test]
fn reads_bundle_identifier_from_a_real_plist() {
    let (_dir, executable) = app_with_info_plist("<string>org.example.qa</string>");
    assert_eq!(bundle_id(&executable).as_deref(), Some("org.example.qa"));
}

#[test]
fn oversized_bundle_identifier_is_not_reported() {
    let (_dir, executable) = app_with_info_plist(&format!("<string>{}</string>", "a".repeat(300)));
    assert!(bundle_id(&executable).is_none());
}

#[test]
fn platform_info_plist_is_never_read() {
    let (_dir, executable) = app_with_info_plist("<string>org.example.small</string>");
    let contents = executable.parent().unwrap().parent().unwrap();
    std::fs::write(contents.join("Info-macos.plist"), format!(
        r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>{}</string></dict></plist>"#,
        "b".repeat(1024 * 1024)
    )).unwrap();
    assert_eq!(bundle_id(&executable).as_deref(), Some("org.example.small"));
}

#[test]
fn fifo_info_plist_is_rejected_without_blocking() {
    let (dir, executable) = app_with_info_plist("<string>org.example.qa</string>");
    let plist = executable.parent().unwrap().parent().unwrap().join("Info.plist");
    std::fs::remove_file(&plist).unwrap();
    let fifo = std::ffi::CString::new(plist.as_os_str().as_encoded_bytes()).unwrap();
    // SAFETY: `fifo` is a valid NUL-terminated path; mkfifo only creates the node.
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let link = dir.path().join("link.plist");
    std::os::unix::fs::symlink(&plist, &link).unwrap();
    let (done, wait) = std::sync::mpsc::channel();
    let (exe, lnk) = (executable.clone(), link.clone());
    std::thread::spawn(move || {
        let _ = done.send((bundle_id(&exe), read_bounded(&lnk)));
    });
    let (id, via_link) = wait.recv_timeout(std::time::Duration::from_secs(5)).expect("FIFO read must not block");
    assert!(id.is_none());
    assert!(via_link.is_none());
}

#[test]
fn reads_at_most_the_plist_limit() {
    let dir = tempfile::tempdir().unwrap();
    let at_limit = dir.path().join("at-limit");
    let over_limit = dir.path().join("over-limit");
    let limit = usize::try_from(MAX_INFO_PLIST_BYTES).unwrap();
    std::fs::write(&at_limit, vec![b'x'; limit]).unwrap();
    std::fs::write(&over_limit, vec![b'x'; limit + 1]).unwrap();
    assert_eq!(read_bounded(&at_limit).map(|bytes| bytes.len()), Some(limit));
    assert!(read_bounded(&over_limit).is_none());
}

#[test]
fn non_string_bundle_identifier_is_not_reported() {
    let (_dir, executable) = app_with_info_plist("<integer>42</integer>");
    assert!(bundle_id(&executable).is_none());
}

#[test]
fn oversized_info_plist_is_not_read() {
    let (_dir, executable) = app_with_info_plist(&format!("<string>org.example.qa</string><key>Pad</key><string>{}</string>", "p".repeat(1024 * 1024 + 1)));
    assert!(bundle_id(&executable).is_none());
}

#[test]
fn bundle_identifier_rejects_characters_outside_reverse_dns() {
    assert!(valid_bundle_id("org.example.qa-1_x"));
    assert!(!valid_bundle_id(""));
    assert!(!valid_bundle_id("org.example qa"));
    assert!(!valid_bundle_id("org\nexample"));
    assert!(!valid_bundle_id(&"a".repeat(256)));
}

#[test]
fn non_app_and_missing_plist_have_no_bundle_identifier() {
    assert!(bundle_id(Path::new("/tmp/engine")).is_none());
    let dir = tempfile::tempdir().unwrap();
    assert!(bundle_id(&dir.path().join("QA.app/Contents/MacOS/QA")).is_none());
}
