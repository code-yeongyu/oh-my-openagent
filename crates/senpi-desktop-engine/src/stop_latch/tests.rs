use super::{account, files, StopLatch};
use std::{
    fs,
    os::unix::fs::{symlink, MetadataExt, PermissionsExt},
};

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
    let latch = StopLatch::for_test(path.clone());
    assert!(!latch.is_stopped());
    // when
    latch.persist().unwrap();
    let restored = StopLatch::for_test(path.clone());
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
    let latch = StopLatch::for_test(temp.path().to_owned());
    // then
    assert!(latch.is_stopped());
    assert_eq!(fs::read(marker).unwrap(), b"not a valid marker");
}

#[test]
fn unreadable_or_overpermissive_marker_starts_stopped() {
    for mode in [0o000, 0o400, 0o644, 0o666] {
        // given
        let temp = private_dir();
        let latch = StopLatch::for_test(temp.path().to_owned());
        latch.persist().unwrap();
        fs::set_permissions(
            temp.path().join(files::MARKER),
            fs::Permissions::from_mode(mode),
        )
        .unwrap();
        // when
        let restored = StopLatch::for_test(temp.path().to_owned());
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
    let latch = StopLatch::for_test(temp.path().to_owned());
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
    let latch = StopLatch::for_test(temp.path().to_owned());
    // then
    assert!(latch.is_stopped());
}

#[test]
fn a_failed_rename_does_not_claim_commit_and_removes_only_its_temporary_file() {
    // given
    let temp = private_dir();
    let latch = StopLatch::for_test(temp.path().to_owned());
    fs::create_dir(temp.path().join(files::MARKER)).unwrap();
    // when
    let result = latch.persist();
    // then
    assert!(result.is_err());
    assert!(!latch.is_stopped());
    assert!(temp.path().join(files::MARKER).is_dir());
    assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    assert!(StopLatch::for_test(temp.path().to_owned()).is_stopped());
}

#[test]
fn r2_l4_read_stays_with_the_validated_directory_after_path_replacement() {
    // given
    let temp = private_dir();
    let original = temp.path().join("state");
    let latch = StopLatch::for_test(original.clone());
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
