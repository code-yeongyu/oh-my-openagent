use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

use omo_computer_safety::self_set::{HostAdditions, ProcessSnapshot, SelfSet, SelfSetInputs};

use crate::self_set::{host_pid, parse_stat, read_processes};

const PTS3: u64 = 34819;
const PTS5: u64 = 34821;

/// One `/proc/<pid>` directory: `stat` with the fields the reader uses, and `cmdline`.
fn proc_dir(
    root: &Path,
    pid: u32,
    name: &str,
    ppid: u32,
    session: u32,
    tty: u64,
    cmdline: &[&str],
) {
    let dir = root.join(pid.to_string());
    fs::create_dir_all(&dir).expect("proc dir");
    let stat = format!(
        "{pid} ({name}) S {ppid} {pid} {session} {tty} 0 4194560 1 0 0 0 0 0 0 0 20 0 1 0 {} 0 0",
        100 + pid
    );
    fs::write(dir.join("stat"), stat).expect("stat");
    fs::write(dir.join("cmdline"), cmdline.join("\0")).expect("cmdline");
}

fn uid() -> u32 {
    fs::metadata("/proc/self")
        .map(|meta| meta.uid())
        .expect("uid")
}

#[test]
fn a_stat_name_may_hold_spaces_and_parentheses() {
    let stat =
        parse_stat("4242 (my (odd) term) S 1 4242 4242 34819 0 0 0 0 0 0 0 0 0 0 20 0 1 0 777 0 0")
            .expect("parsed");
    assert_eq!(
        (
            stat.pid,
            stat.name.as_str(),
            stat.ppid,
            stat.session,
            stat.tty_nr,
            stat.start
        ),
        (4242, "my (odd) term", 1, 4242, PTS3, 777)
    );
}

#[test]
fn host_pid_reads_both_spellings() {
    assert_eq!(
        host_pid(b"omo-computer-engine\0--host-pid\0900\0--stdio"),
        Some(900)
    );
    assert_eq!(host_pid(b"omo-computer-engine\0--host-pid=901"), Some(901));
    assert_eq!(host_pid(b"omo-computer-engine\0--stdio"), None);
}

#[test]
fn linux_self_set_includes_sibling_engine_host_chain_and_tty() {
    let root = tempfile_root("self-set");
    // xterm 10 -> bash 11 (session leader on pts/3) -> omo 12 (the brain) -> this engine 13.
    proc_dir(&root, 10, "xterm", 1, 10, 0, &["xterm"]);
    proc_dir(&root, 11, "bash", 10, 11, PTS3, &["bash"]);
    proc_dir(&root, 12, "omo", 11, 11, PTS3, &["omo"]);
    proc_dir(
        &root,
        13,
        "omo-computer-engine",
        12,
        11,
        PTS3,
        &["omo-computer-engine", "--stdio"],
    );
    // A sibling engine hosted by an editor in another terminal: gnome-terminal 20 -> zsh 21 on
    // pts/5 -> editor 22 -> omo-computer-engine 23 --host-pid 22.
    proc_dir(
        &root,
        20,
        "gnome-terminal-",
        1,
        20,
        0,
        &["gnome-terminal-server"],
    );
    proc_dir(&root, 21, "zsh", 20, 21, PTS5, &["zsh"]);
    proc_dir(&root, 22, "code", 21, 21, PTS5, &["code"]);
    proc_dir(
        &root,
        23,
        "omo-computer-eng",
        22,
        21,
        PTS5,
        &["omo-computer-engine", "--host-pid", "22"],
    );
    // An unrelated app the engine may drive.
    proc_dir(&root, 30, "gedit", 1, 30, 0, &["gedit"]);

    let table = read_processes(&root, uid());
    assert_eq!(table.tty_owners, vec![(PTS3, 10), (PTS5, 20)]);
    let snapshot = ProcessSnapshot::from(&table);
    let set = SelfSet::compute(&SelfSetInputs {
        own_pid: 13,
        snapshot: &snapshot,
        brain_locks: &[],
        brain_names: &[],
        additions: &HostAdditions::default(),
    });
    for pid in [13, 12, 11, 10, 23, 22, 21, 20] {
        assert!(set.contains_pid(pid), "pid {pid} must be in the self set");
    }
    assert!(!set.contains_pid(30), "an unrelated app stays drivable");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn another_uids_processes_are_not_read() {
    let root = tempfile_root("other-uid");
    proc_dir(&root, 40, "bash", 1, 40, PTS3, &["bash"]);
    assert_eq!(
        read_processes(&root, uid().wrapping_add(1)).processes.len(),
        0
    );
    assert_eq!(read_processes(&root, uid()).processes.len(), 1);
    let _ = fs::remove_dir_all(&root);
}

fn tempfile_root(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("omo-x11-proc-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("root");
    dir
}

#[test]
fn self_target_terminal_is_refused() {
    use omo_computer_core::backend::Backend;
    use omo_computer_core::params::Point;
    use omo_computer_safety::{
        Call, Gate, Guard, HostAdditions as Additions, StopPolicy, TargetRef, VerbKind,
    };

    use crate::capture::fake::{FakeX, GREEN};
    use crate::capture::server::PixelRect;
    use crate::stop_path::fake::FakeKeys;
    use crate::stop_path::{arm, Armed, LeaseEndSignal, Live, DEFAULT_STOP_CHORD};

    let root = tempfile_root("self-target");
    proc_dir(&root, 10, "xterm", 1, 10, 0, &["xterm"]);
    proc_dir(&root, 11, "bash", 10, 11, PTS3, &["bash"]);
    proc_dir(&root, 12, "omo", 11, 11, PTS3, &["omo"]);
    proc_dir(&root, 30, "gedit", 1, 30, 0, &["gedit"]);
    let rect = PixelRect {
        x: 0,
        y: 0,
        width: 40,
        height: 40,
    };
    let mut server = FakeX::single(160, 120)
        .with_window(9, rect, GREEN)
        .with_window(8, rect, GREEN);
    server.pids = vec![(9, 10), (8, 30)];
    let live = Live::for_display(None).with_proc_root(root.clone());
    let mut backend =
        crate::X11Backend::with_live(Some(crate::X11Capture::new(server, None)), live);

    let mut guard = Guard::in_memory();
    guard
        .open_on(
            &backend,
            StopPolicy {
                allow_host_relay_only: false,
            },
            Additions::default(),
        )
        .expect("open");
    let keys = FakeKeys::new((2, 2));
    let Ok(Armed::Live(listener)) =
        arm(keys.boxed(), DEFAULT_STOP_CHORD, LeaseEndSignal::default())
    else {
        panic!("armed");
    };
    guard.start(Ok(Box::new(listener)), None);
    let call = |window| Call {
        verb: VerbKind::Pointer,
        target: TargetRef::Window(window),
        points: vec![Point { x: 5.0, y: 5.0 }],
        chord: None,
        force: true,
    };
    let refused = guard
        .admit_on(&mut backend, &call("9"))
        .expect_err("the terminal is self");
    assert_eq!(
        (refused.gate, refused.refusal.reason),
        (Gate::Target, Some("self_target"))
    );
    assert!(backend
        .processes()
        .is_some_and(|table| table.processes.len() == 4));
    assert!(
        guard.admit_on(&mut backend, &call("8")).is_ok(),
        "an unrelated app is admitted"
    );
    let _ = fs::remove_dir_all(&root);
}
