//! The Windows readers the safety crate's rules run on: presence exclusion, the self set's process
//! snapshot, and the protected table's identity.

use omo_computer_safety::protected::{Os, ProtectedTable};
use omo_computer_safety::self_set::{HostAdditions, SelfSet, SelfSetInputs};

use crate::overlay::{exclusion, Exclusion};
use crate::protected::identity;
use crate::self_set::{host_pid_of, snapshot, RawProcess};

#[test]
fn overlay_excluded_from_capture_by_affinity() {
    assert_eq!(
        exclusion(true, Some(0)),
        Exclusion::Affinity,
        "the spike row CONFIRMS and the oracle reads 0"
    );
    assert_eq!(
        exclusion(true, Some(3)),
        Exclusion::HideAck,
        "any leaked pixel ships hide_ack"
    );
    assert_eq!(
        exclusion(false, Some(0)),
        Exclusion::HideAck,
        "a contradicting spike row ships hide_ack"
    );
    assert_eq!(
        exclusion(true, None),
        Exclusion::HideAck,
        "unmeasured is never affinity"
    );
}

fn raw(pid: u32, ppid: u32, start: u64, name: &str, console: Option<u64>, cmd: &str) -> RawProcess {
    RawProcess {
        pid,
        ppid,
        start,
        image: format!(r"C:\bin\{name}"),
        console,
        command_line: cmd.to_owned(),
    }
}

#[test]
fn windows_self_set_includes_sibling_host_chain_and_console_owner() {
    assert_eq!(
        host_pid_of("omo-computer-engine.exe --stdio --host-pid 500"),
        Some(500)
    );
    assert_eq!(
        host_pid_of("omo-computer-engine.exe --host-pid=501"),
        Some(501)
    );
    assert_eq!(host_pid_of("omo-computer-engine.exe --stdio"), None);
    let processes = vec![
        raw(
            100,
            1,
            10,
            "omo-computer-engine.exe",
            None,
            "omo-computer-engine.exe --daemon",
        ),
        raw(300, 250, 20, "WindowsTerminal.exe", None, ""),
        raw(310, 300, 21, "OpenConsole.exe", None, ""),
        raw(400, 300, 30, "pwsh.exe", Some(7), ""),
        raw(500, 400, 40, "omo.exe", Some(7), ""),
        raw(
            600,
            500,
            50,
            "omo-computer-engine.exe",
            None,
            "omo-computer-engine.exe --stdio --host-pid 500",
        ),
        // A recycled pid: 900's recorded parent 800 started AFTER it, so the chain stops.
        raw(800, 1, 99, "notepad.exe", None, ""),
        raw(900, 800, 60, "other.exe", None, ""),
    ];
    let snapshot = snapshot(&processes, &[(7, 310)]);
    let additions = HostAdditions::default();
    let set = SelfSet::compute(&SelfSetInputs {
        own_pid: 100,
        snapshot: &snapshot,
        brain_locks: &[],
        brain_names: &[],
        additions: &additions,
    });
    for pid in [100, 600, 500, 400, 300, 310] {
        assert!(set.contains_pid(pid), "pid {pid} is in the self set");
    }
    assert!(!set.contains_pid(900) && !set.contains_pid(800));
}

#[test]
fn protected_process_is_refused() {
    let table = ProtectedTable::of(Os::Windows);
    let consent = identity(42, r"C:\Windows\System32\consent.exe", None);
    assert!(table.is_protected_surface(&consent, true));
    let explorer = identity(43, r"C:\Windows\explorer.exe", None);
    assert!(table.is_protected_process(&explorer), "never quit");
    let keepass = identity(44, r"C:\Program Files\KeePass\KeePass.exe", None);
    assert!(table.is_denied_app(&keepass));
    let notepad = identity(45, r"C:\Windows\notepad.exe", None);
    assert!(!table.is_protected_surface(&notepad, true) && !table.is_protected_process(&notepad));
    // A packaged app is keyed by its AUMID.
    let packaged = identity(
        46,
        r"C:\Program Files\WindowsApps\x\1Password.exe",
        Some("Agilebits.1Password_abc!App"),
    );
    assert!(table.is_denied_app(&packaged));
}
