use super::{account, files, StopLatch};
use std::{
    ffi::{CStr, OsStr},
    fs,
    os::unix::{
        ffi::OsStrExt,
        fs::{symlink, MetadataExt, PermissionsExt},
    },
    path::{Path, PathBuf},
};

/// The per-user directory a production build persists the stop to. Only a
/// production build compiles `account::home`, so read the account record here.
fn real_directory() -> PathBuf {
    let mut record = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut storage = vec![0u8; 16 * 1024];
    let mut result = std::ptr::null_mut();
    // SAFETY: all outputs are writable; the buffer outlives every read of the record.
    let status = unsafe {
        libc::getpwuid_r(account::uid(), record.as_mut_ptr(), storage.as_mut_ptr().cast(), storage.len(), &mut result)
    };
    assert!(status == 0 && !result.is_null(), "the test account has a passwd record");
    // SAFETY: a successful getpwuid_r with a non-null result initialized the record.
    let home = unsafe { CStr::from_ptr(record.assume_init().pw_dir) };
    PathBuf::from(OsStr::from_bytes(home.to_bytes()))
        .join("Library/Application Support/OmO/ComputerControl/xpc-v1")
}

/// The only way these tests build a latch: never in the real per-user directory.
fn isolated_latch(directory: &Path) -> StopLatch {
    assert!(
        !directory.starts_with(real_directory()),
        "a stop-latch test aimed at the real per-user stop directory: {}",
        directory.display()
    );
    StopLatch::for_test(directory.to_owned())
}

/// The real directory's entries, `None` when it does not exist.
fn real_entries() -> Option<Vec<std::ffi::OsString>> {
    let mut names: Vec<_> = fs::read_dir(real_directory())
        .ok()?
        .map(|entry| entry.unwrap().file_name())
        .collect();
    names.sort();
    Some(names)
}

fn private_dir() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    directory
}

#[test]
fn missing_marker_is_clear_and_atomic_commit_survives_a_fresh_owner() {
    // given
    let temp = private_dir();
    let path = temp.path().join("private");
    let latch = isolated_latch(&path);
    assert!(!latch.is_stopped());
    // when
    latch.persist().unwrap();
    let restored = isolated_latch(&path);
    // then
    assert!(restored.is_stopped());
    assert_eq!(fs::metadata(&path).unwrap().mode() & 0o7777, 0o700);
    let marker = fs::metadata(path.join(files::MARKER)).unwrap();
    assert_eq!(marker.uid(), account::uid());
    assert_eq!(marker.mode() & 0o7777, 0o600);
    assert_eq!(fs::read_dir(path).unwrap().count(), 1);
}

#[test]
fn malformed_marker_starts_stopped_without_rewriting_it() {
    // given
    let temp = private_dir();
    let marker = temp.path().join(files::MARKER);
    fs::write(&marker, b"not a valid marker").unwrap();
    fs::set_permissions(&marker, fs::Permissions::from_mode(0o600)).unwrap();
    let opened = files::directory(temp.path(), account::uid()).unwrap();
    assert_eq!(files::read(&opened, account::uid()).unwrap_err().kind(), std::io::ErrorKind::InvalidData);
    // when
    let latch = isolated_latch(temp.path());
    // then
    assert!(latch.is_stopped());
    assert_eq!(fs::read(marker).unwrap(), b"not a valid marker");
}

#[test]
fn unreadable_or_overpermissive_marker_starts_stopped() {
    for mode in [0o000, 0o400, 0o644, 0o666] {
        // given
        let temp = private_dir();
        let latch = isolated_latch(temp.path());
        latch.persist().unwrap();
        fs::set_permissions(
            temp.path().join(files::MARKER),
            fs::Permissions::from_mode(mode),
        )
        .unwrap();
        // when
        let restored = isolated_latch(temp.path());
        // then
        assert!(restored.is_stopped());
    }
}

#[test]
fn wrong_directory_permissions_fail_closed_even_without_a_marker() {
    // given
    let temp = private_dir();
    fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o755)).unwrap();
    // when
    let latch = isolated_latch(temp.path());
    // then
    assert!(latch.is_stopped());
    assert!(!temp.path().join(files::MARKER).exists());
}

#[test]
fn metadata_from_a_different_owner_is_refused() {
    // given
    let temp = private_dir();
    let metadata = fs::metadata(temp.path()).unwrap();
    let another_uid = account::uid().checked_add(1).unwrap();
    // when
    let result = files::validate(&metadata, another_uid, 0o700);
    // then
    assert_eq!(
        result.unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
}

#[test]
fn dangling_marker_symlink_is_not_treated_as_missing() {
    // given
    let temp = private_dir();
    symlink(temp.path().join("absent"), temp.path().join(files::MARKER)).unwrap();
    // when
    let latch = isolated_latch(temp.path());
    // then
    assert!(latch.is_stopped());
}

#[test]
fn a_failed_rename_does_not_claim_commit_and_removes_only_its_temporary_file() {
    // given
    let temp = private_dir();
    let latch = isolated_latch(temp.path());
    fs::create_dir(temp.path().join(files::MARKER)).unwrap();
    // when
    let result = latch.persist();
    // then
    assert!(result.is_err());
    assert!(!latch.is_stopped());
    assert!(temp.path().join(files::MARKER).is_dir());
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    assert!(isolated_latch(temp.path()).is_stopped());
}

#[test]
fn r2_l4_read_stays_with_the_validated_directory_after_path_replacement() {
    // given
    let temp = private_dir();
    let original = temp.path().join("state");
    let latch = isolated_latch(&original);
    latch.persist().unwrap();
    let opened = files::directory(&original, account::uid()).unwrap();
    // when
    fs::rename(&original, temp.path().join("moved")).unwrap();
    fs::create_dir(&original).unwrap();
    fs::set_permissions(&original, fs::Permissions::from_mode(0o700)).unwrap();
    // then
    assert!(files::read(&opened, account::uid()).unwrap(), "read followed the replacement pathname");
}

#[test]
fn r2_l4_write_stays_with_the_validated_directory_after_path_replacement() {
    // given
    let temp = private_dir();
    let original = temp.path().join("state");
    let opened = files::directory(&original, account::uid()).unwrap();
    let moved = temp.path().join("moved");
    // when
    fs::rename(&original, &moved).unwrap();
    fs::create_dir(&original).unwrap();
    files::commit_at(&opened).unwrap();
    // then
    assert!(moved.join(files::MARKER).exists(), "commit followed the replacement pathname");
    assert!(!original.join(files::MARKER).exists());
}

#[test]
fn stop_latch_tests_leave_no_file_under_the_real_per_user_directory() {
    // given
    let before = real_entries();
    let temp = private_dir();
    // when
    let stopped = isolated_latch(temp.path());
    stopped.persist().unwrap();
    // then
    assert!(isolated_latch(temp.path()).is_stopped());
    assert_eq!(real_entries(), before, "a stop-latch test changed the real per-user directory");
}

#[test]
#[should_panic(expected = "real per-user stop directory")]
fn a_test_double_aimed_at_the_real_directory_fails_the_isolation_guard() {
    // given / when: refused before anything is opened or written
    let _ = isolated_latch(&real_directory().join("isolation-control"));
}
