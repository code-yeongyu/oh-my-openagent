//! The file marker: dir 0700, file 0600, the exact content, `O_NOFOLLOW`, and every
//! unreadable state read as stopped.

use std::fs;

use super::{FileMarker, MarkerState, MarkerStore, MARKER_CONTENT};

#[test]
fn commit_writes_the_marker_privately_and_reads_it_back() {
    let root = tempfile::tempdir().expect("temp dir");
    let path = root.path().join("state/omo/global-stop");
    let mut marker = FileMarker::at(path.clone());
    assert_eq!(marker.read(), MarkerState::Absent);
    marker.commit().expect("commit");
    assert_eq!(fs::read(&path).expect("read"), MARKER_CONTENT);
    assert_eq!(marker.read(), MarkerState::Present);
    marker.commit().expect("a second commit replaces the file");
    let leftovers: Vec<_> = fs::read_dir(path.parent().expect("dir"))
        .expect("list")
        .flatten()
        .map(|entry| entry.file_name())
        .collect();
    assert_eq!(
        leftovers,
        vec![std::ffi::OsString::from("global-stop")],
        "no temp file remains"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode =
            |p: &std::path::Path| fs::metadata(p).expect("meta").permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().expect("dir")), 0o700);
    }
}

#[test]
fn a_torn_or_foreign_marker_reads_unreadable_and_stops() {
    let root = tempfile::tempdir().expect("temp dir");
    let path = root.path().join("global-stop");
    fs::write(&path, b"omo-glo").expect("torn write");
    let marker = FileMarker::at(path);
    assert_eq!(marker.read(), MarkerState::Unreadable);
    assert!(marker.read().stops());
    assert!(!MarkerState::Absent.stops());
}

#[cfg(unix)]
#[test]
fn a_symlinked_marker_is_never_followed() {
    let root = tempfile::tempdir().expect("temp dir");
    let target = root.path().join("elsewhere");
    fs::write(&target, MARKER_CONTENT).expect("target");
    let path = root.path().join("global-stop");
    std::os::unix::fs::symlink(&target, &path).expect("symlink");
    assert_eq!(FileMarker::at(path).read(), MarkerState::Unreadable);
}

#[cfg(unix)]
#[test]
fn a_world_readable_directory_is_narrowed_to_the_owner() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().expect("temp dir");
    let dir = root.path().join("state");
    fs::create_dir(&dir).expect("dir");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).expect("chmod");
    FileMarker::at(dir.join("global-stop"))
        .commit()
        .expect("commit");
    assert_eq!(
        fs::metadata(&dir).expect("meta").permissions().mode() & 0o777,
        0o700
    );
}
