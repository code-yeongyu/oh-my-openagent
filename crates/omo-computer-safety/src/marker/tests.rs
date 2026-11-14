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

/// Ruling (LEAD via duty, amendment A-IS-60): a Windows stop marker is committed only on NTFS
/// or ReFS; any other filesystem, or one whose name cannot be read, refuses with a typed error
/// that names what was read. The name reader is injected here; the hosted Windows marker test
/// makes the real call on the runner's volume.
#[test]
fn the_marker_filesystem_is_ntfs_or_refs_and_anything_else_refuses_naming_it() {
    use super::{admit_filesystem, UnsupportedFilesystem};
    let named = |name: &str| admit_filesystem(Ok(name.to_owned()));
    assert!(named("NTFS").is_ok(), "NTFS");
    assert!(named("ReFS").is_ok(), "ReFS");
    for refused in ["FAT", "FAT32", "exFAT", "NFS", "", "ntfs"] {
        let error = named(refused).expect_err(refused);
        let typed = error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<UnsupportedFilesystem>())
            .unwrap_or_else(|| panic!("{refused:?}: a typed error, got {error:?}"));
        assert_eq!(typed.name, refused);
        assert!(
            error.to_string().contains(&format!("{refused:?}")),
            "{error}"
        );
    }
    let unreadable =
        admit_filesystem(Err(std::io::Error::other("volume gone"))).expect_err("unreadable");
    let typed = unreadable
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<UnsupportedFilesystem>())
        .expect("a typed error");
    assert!(typed.name.starts_with("unreadable") && typed.name.contains("volume gone"), "{}", typed.name);
}

/// Review L1 of #13353 (at f8489aad9d): a commit whose rename is refused leaves no temp file
/// behind; the marker's directory holds only what was there before.
#[test]
fn a_refused_rename_leaves_no_temp_file_behind() {
    let root = tempfile::tempdir().expect("temp dir");
    let path = root.path().join("state/omo/global-stop");
    // A non-empty directory where the marker goes: the rename onto it is refused on every OS.
    fs::create_dir_all(path.join("occupied")).expect("a directory in the marker's place");
    let mut marker = FileMarker::at(path.clone());
    assert!(marker.commit().is_err(), "the rename onto a directory is refused");
    let left: Vec<String> = fs::read_dir(path.parent().expect("dir"))
        .expect("list")
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(left, vec!["global-stop".to_owned()], "no temp file remains: {left:?}");
}
