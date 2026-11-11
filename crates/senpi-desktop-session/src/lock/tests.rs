use std::path::{Path, PathBuf};
use std::time::Instant;

use senpi_desktop_core::error::{DesktopError, ErrorCode};

use super::{linux_base, InteractionLock, UserRuntimeDir, WAIT_BUDGET};

fn never() -> Option<DesktopError> {
    None
}

#[test]
fn linux_uses_an_absolute_xdg_runtime_dir() {
    // When
    let base = linux_base(Some("/run/user/1000".into()), 1000, |_| false);
    // Then
    assert_eq!(base.expect("resolves"), PathBuf::from("/run/user/1000"));
}

#[test]
fn linux_ignores_a_relative_xdg_runtime_dir_and_takes_run_user() {
    // When
    let base = linux_base(Some("relative/dir".into()), 1234, |dir| dir == Path::new("/run/user/1234"));
    // Then
    assert_eq!(base.expect("resolves"), PathBuf::from("/run/user/1234"));
}

#[test]
fn linux_without_a_runtime_dir_is_an_error_never_the_temp_dir() {
    // When
    let error = linux_base(None, 1234, |_| false).expect_err("no runtime dir");
    // Then
    assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    assert!(error.to_string().contains("never falls back"), "{error}");
}

#[cfg(target_os = "linux")]
#[test]
fn linux_resolves_xdg_or_run_user_and_creates_a_private_dir() {
    use std::os::unix::fs::PermissionsExt;

    // Given: the host's own rule (skipped where the host has neither)
    let Ok(dir) = super::user_runtime_dir() else {
        assert!(std::env::var_os("XDG_RUNTIME_DIR").is_none(), "an XDG_RUNTIME_DIR must resolve");
        return;
    };
    // Then
    assert!(dir.path.ends_with("senpi-desktop"), "{dir:?}");
    assert!(!dir.path.starts_with(std::env::temp_dir()), "{dir:?}");
    let mode = std::fs::metadata(&dir.path).expect("created").permissions().mode();
    assert_eq!(mode & 0o077, 0, "{mode:o}");
}

#[cfg(target_os = "macos")]
#[test]
fn macos_resolves_the_launchd_user_temp_dir_whatever_tmpdir_says() {
    // When
    let base = super::platform_base().expect("confstr answers");
    // Then: an absolute per-user directory that exists
    assert!(base.is_absolute() && base.is_dir(), "{base:?}");
    let dir = super::user_runtime_dir().expect("resolves");
    assert_eq!(dir.path, base.join("senpi-desktop"));
}

#[cfg(windows)]
#[test]
fn windows_names_the_mutex_with_the_user_sid() {
    // When
    let sid = super::windows::user_sid().expect("the process token names its user");
    // Then
    assert!(sid.starts_with("S-1-"), "{sid}");
}

#[test]
fn the_entry_is_named_by_the_owner() {
    // Given
    let dir = UserRuntimeDir {
        path: PathBuf::from("/r/senpi-desktop"),
        owner: 501,
    };
    // Then
    assert_eq!(dir.entry("lock"), PathBuf::from("/r/senpi-desktop/501.lock"));
    assert_eq!(dir.entry("sock"), PathBuf::from("/r/senpi-desktop/501.sock"));
}

#[test]
fn a_process_only_lock_takes_nothing_machine_wide() {
    // When
    let held = InteractionLock::default().acquire(false, &never).expect("no lock to take");
    // Then
    assert!(held.is_none());
}

#[test]
fn a_second_holder_is_refused_input_busy_after_the_budget_then_proceeds() {
    // Given: two locks naming one directory, as two engine processes do
    let dir = tempfile::tempdir().expect("temp dir");
    let first = InteractionLock::at(dir.path().to_owned());
    let second = InteractionLock::at(dir.path().to_owned());
    let held = first.acquire(false, &never).expect("free").expect("machine-wide");
    // When
    let started = Instant::now();
    let busy = second.acquire(false, &never).map(|held| held.is_some());
    // Then
    assert_eq!(busy.map_err(|error| error.code), Err(ErrorCode::InputBusy));
    assert!(started.elapsed() >= WAIT_BUDGET, "{:?}", started.elapsed());
    drop(held);
    assert!(second.acquire(false, &never).expect("released").is_some());
}

#[test]
fn a_stop_ends_the_wait_with_its_own_error() {
    // Given
    let dir = tempfile::tempdir().expect("temp dir");
    let first = InteractionLock::at(dir.path().to_owned());
    let _held = first.acquire(false, &never).expect("free");
    // When
    let stopped = InteractionLock::at(dir.path().to_owned())
        .acquire(false, &|| Some(DesktopError::new(ErrorCode::Suspended, "stopped")))
        .map(|held| held.is_some());
    // Then
    assert_eq!(stopped.map_err(|error| error.code), Err(ErrorCode::Suspended));
}

#[test]
fn an_unusable_lock_directory_is_a_structured_error_not_a_fallback() {
    // Given: the directory is a regular file
    let dir = tempfile::tempdir().expect("temp dir");
    let blocked = dir.path().join("not-a-dir");
    std::fs::write(&blocked, b"").expect("file");
    // When
    let refused = InteractionLock::at(blocked).acquire(false, &never).map(|held| held.is_some());
    // Then
    let error = refused.expect_err("unusable");
    assert_eq!(error.code, ErrorCode::TransactionFailed);
    assert!(error.message.contains("no input was sent"), "{}", error.message);
}

#[cfg(unix)]
#[test]
fn a_read_only_lock_directory_is_a_structured_error() {
    use std::os::unix::fs::PermissionsExt;

    // Given: senpi-desktop/ exists but is not writable (root writes anyway)
    // SAFETY: geteuid takes no arguments and cannot fail.
    if unsafe { libc::geteuid() } == 0 {
        return;
    }
    let dir = tempfile::tempdir().expect("temp dir");
    let locks = dir.path().join("senpi-desktop");
    std::fs::create_dir(&locks).expect("dir");
    std::fs::set_permissions(&locks, std::fs::Permissions::from_mode(0o500)).expect("chmod");
    // When
    let refused = InteractionLock::at(dir.path().to_owned()).acquire(false, &never).map(|held| held.is_some());
    // Then
    let error = refused.expect_err("not writable");
    assert_eq!(error.code, ErrorCode::TransactionFailed);
    assert!(error.message.contains(".lock"), "{}", error.message);
    std::fs::set_permissions(&locks, std::fs::Permissions::from_mode(0o700)).expect("chmod back");
}
