//! `ClientProcess::read` against a fake `/proc` tree.

use std::fs;
use std::path::{Path, PathBuf};

use super::client_process::ClientProcess;

/// A scratch `/proc` root removed when dropped.
struct ProcRoot(PathBuf);

impl ProcRoot {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("x11-proc-{name}-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create fake /proc");
        Self(root)
    }

    fn process(&self, pid: u32, maps: &str, cmdline: &[u8], children: &str) -> &Self {
        let dir = self.0.join(pid.to_string());
        fs::create_dir_all(dir.join("task").join(pid.to_string())).expect("create process dir");
        fs::write(dir.join("maps"), maps).expect("write maps");
        fs::write(dir.join("cmdline"), cmdline).expect("write cmdline");
        fs::write(dir.join("task").join(pid.to_string()).join("children"), children).expect("write children");
        self
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for ProcRoot {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_dir_all(&self.0) {
            eprintln!("fake /proc {} not removed: {error}", self.0.display());
        }
    }
}

const GTK_MAPS: &str = "\
5571d000-5571e000 r--p 00000000 08:01 1 /usr/bin/python3.12
7f00a000-7f00b000 r-xp 00000000 08:01 2 /usr/lib/x86_64-linux-gnu/libgtk-3.so.0.2409.32
7f00c000-7f00d000 r-xp 00001000 08:01 2 /usr/lib/x86_64-linux-gnu/libgtk-3.so.0.2409.32
7f00e000-7f00f000 rw-p 00000000 00:00 0 [heap]
7f010000-7f011000 r-xp 00000000 08:01 3 /usr/lib/x86_64-linux-gnu/libX11.so.6.4.0
";

#[test]
fn a_process_lists_its_mapped_libraries_once_and_its_arguments() {
    // Given
    let root = ProcRoot::new("gtk");
    root.process(41, GTK_MAPS, b"python3\0fixture.py\0--report\0/tmp/r.json\0", "");
    // When
    let process = ClientProcess::read(root.path(), 41).expect("readable process");
    // Then
    assert_eq!(process.libraries, ["libX11.so.6.4.0", "libgtk-3.so.0.2409.32"]);
    assert_eq!(process.args, ["python3", "fixture.py", "--report", "/tmp/r.json"]);
    assert_eq!(process.exe, None, "the fake /proc has no exe link");
    assert!(!process.chromium_helpers);
}

#[test]
fn a_child_with_a_type_argument_marks_a_chromium_helper_tree() {
    // Given: pid 50's thread lists two children, one a zygote helper.
    let root = ProcRoot::new("chromium");
    root.process(50, "", b"/opt/app/app\0", "51 52 ")
        .process(51, "", b"/opt/app/app\0--type=zygote\0", "")
        .process(52, "", b"/usr/bin/xdg-settings\0", "");
    // When
    let process = ClientProcess::read(root.path(), 50).expect("readable process");
    // Then
    assert!(process.chromium_helpers);
}

#[test]
fn the_exe_link_names_the_binary_even_after_it_was_replaced_on_disk() {
    // Given: pid 60 runs a binary that a package upgrade has since replaced.
    let root = ProcRoot::new("exe");
    root.process(60, GTK_MAPS, b"/usr/local/bin/myterm\0", "");
    std::os::unix::fs::symlink("/usr/bin/xterm (deleted)", root.path().join("60").join("exe")).expect("exe link");
    // When
    let process = ClientProcess::read(root.path(), 60).expect("readable process");
    // Then
    assert_eq!(process.exe.as_deref(), Some("/usr/bin/xterm"));
}

#[test]
fn a_process_that_is_gone_is_an_error_naming_it() {
    // Given
    let root = ProcRoot::new("gone");
    // When
    let error = ClientProcess::read(root.path(), 77).expect_err("no such process");
    // Then
    assert!(error.contains("/proc/77/maps"), "{error}");
}
