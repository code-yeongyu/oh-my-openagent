use super::lock_path;
use std::process::Command;

const TEST: &str = "overlay::account_path_tests::lock_location_ignores_home_and_tmpdir_overrides";

#[test]
fn lock_location_ignores_home_and_tmpdir_overrides() {
    if std::env::var_os("SENPI_CURSOR_PATH_CHILD").is_some() {
        println!("\nACCOUNT_LOCK {}", lock_path().unwrap().display());
        return;
    }
    let expected = lock_path().unwrap();
    // A read-only/managed account home is not a dependency of cursor-off screenshots.
    let home = objc2_foundation::NSHomeDirectory().to_string();
    assert!(!expected.starts_with(home));
    let dir = tempfile::tempdir().unwrap();
    for name in ["first-home", "second-home"] {
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture"])
            .env("SENPI_CURSOR_PATH_CHILD", "1")
            .env("HOME", dir.path().join(name))
            .env("TMPDIR", dir.path().join(format!("{name}-tmp")))
            .output().unwrap();
        assert!(output.status.success());
        let output = String::from_utf8(output.stdout).unwrap();
        let path = output.lines().find_map(|line| line.strip_prefix("ACCOUNT_LOCK ")).unwrap();
        assert_eq!(std::path::Path::new(path), expected);
    }
}
