//! Gate review a5: a new segment's chain link is the previous line's `lineHash`. An audit
//! file that is there and cannot be read is an error the writer logs, never a silent
//! missing link (which would restart `prev` at `meta` and break the chain unseen).

use std::fs;

use crate::audit::segment::last_line_hash;

#[test]
fn an_audit_file_that_cannot_be_read_is_an_error_not_a_missing_link() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("audit.jsonl");
    assert!(
        matches!(last_line_hash(&file), Ok(None)),
        "no file: no link"
    );
    fs::write(&file, "{\"lineHash\":\"aa\"}\n{\"lineHash\":\"bb\"}\n").expect("file");
    assert_eq!(
        last_line_hash(&file).expect("readable"),
        Some("bb".to_owned())
    );
    let unreadable = dir.path().join("a-dir.jsonl");
    fs::create_dir(&unreadable).expect("a directory where the file goes");
    assert!(
        last_line_hash(&unreadable).is_err(),
        "a file that is there and cannot be read is an error"
    );
}
