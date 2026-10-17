//! An engine a launcher made its own responsible process is refused before it
//! serves a single request (#10207); an ordinary child still serves.
#![cfg(target_os = "macos")]

use std::ffi::CString;
use std::process::Command;

const BINARY: &str = env!("CARGO_BIN_EXE_senpi-desktop-engine");
const TWO_DISPLAYS: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../senpi-desktop-backend-fake/fixtures/two-displays-one-window.json"
);

unsafe extern "C" {
    fn responsibility_spawnattrs_setdisclaim(
        attrs: *mut libc::posix_spawnattr_t,
        disclaim: libc::c_int,
    ) -> libc::c_int;
}

struct Exit {
    code: i32,
    stderr: String,
}

fn spawn_engine(disclaim: bool) -> Exit {
    spawn_engine_with(disclaim, &["--stdio"])
}

/// Spawns the engine with `args`, stdin from /dev/null, stderr to a file, and
/// the responsibility disclaim attribute set as requested.
fn spawn_engine_with(disclaim: bool, mode_args: &[&str]) -> Exit {
    let dir = tempfile::tempdir().expect("temp dir");
    let stderr_path = dir.path().join("stderr");
    let c = |text: &str| CString::new(text).expect("no interior nul");
    let program = c(BINARY);
    let args: Vec<CString> = std::iter::once(BINARY)
        .chain(mode_args.iter().copied())
        .map(c)
        .collect();
    let env = [c(&format!("SENPI_DESKTOP_BACKEND=fake:{TWO_DISPLAYS}"))];
    let (null, stderr_file) = (c("/dev/null"), c(stderr_path.to_str().expect("utf-8 path")));
    let mut argv: Vec<*mut libc::c_char> = args.iter().map(|arg| arg.as_ptr().cast_mut()).collect();
    argv.push(std::ptr::null_mut());
    let mut envp: Vec<*mut libc::c_char> = env.iter().map(|var| var.as_ptr().cast_mut()).collect();
    envp.push(std::ptr::null_mut());
    let mut pid: libc::pid_t = 0;
    let mut status: libc::c_int = 0;
    // SAFETY: every pointer passed below refers to a live, nul-terminated
    // CString or to an attribute/action object initialized here and destroyed
    // before the borrowed CStrings go out of scope; argv and envp end in null.
    unsafe {
        let mut attrs: libc::posix_spawnattr_t = std::ptr::null_mut();
        let mut actions: libc::posix_spawn_file_actions_t = std::ptr::null_mut();
        assert_eq!(libc::posix_spawnattr_init(&raw mut attrs), 0);
        assert_eq!(libc::posix_spawn_file_actions_init(&raw mut actions), 0);
        if disclaim {
            assert_eq!(responsibility_spawnattrs_setdisclaim(&raw mut attrs, 1), 0);
        }
        libc::posix_spawn_file_actions_addopen(
            &raw mut actions,
            0,
            null.as_ptr(),
            libc::O_RDONLY,
            0,
        );
        libc::posix_spawn_file_actions_addopen(
            &raw mut actions,
            1,
            null.as_ptr(),
            libc::O_WRONLY,
            0,
        );
        libc::posix_spawn_file_actions_addopen(
            &raw mut actions,
            2,
            stderr_file.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC,
            0o600,
        );
        let spawned = libc::posix_spawn(
            &raw mut pid,
            program.as_ptr(),
            &raw const actions,
            &raw const attrs,
            argv.as_ptr(),
            envp.as_ptr(),
        );
        libc::posix_spawn_file_actions_destroy(&raw mut actions);
        libc::posix_spawnattr_destroy(&raw mut attrs);
        assert_eq!(spawned, 0, "posix_spawn failed");
        assert_eq!(libc::waitpid(pid, &raw mut status, 0), pid);
    }
    assert!(
        libc::WIFEXITED(status),
        "engine did not exit normally: {status}"
    );
    Exit {
        code: libc::WEXITSTATUS(status),
        stderr: std::fs::read_to_string(&stderr_path).expect("stderr file"),
    }
}

#[test]
fn a_disclaimed_engine_is_refused_before_serving() {
    // When
    let exit = spawn_engine(true);
    // Then
    assert_ne!(exit.code, 0, "{}", exit.stderr);
    assert!(
        exit.stderr.contains("own responsible process"),
        "{}",
        exit.stderr
    );
}

#[test]
fn an_engine_charged_to_its_launcher_serves() {
    // When
    let exit = spawn_engine(false);
    // Then
    assert_eq!(exit.code, 0, "{}", exit.stderr);
    assert!(!exit.stderr.contains("refusing"), "{}", exit.stderr);
}

#[test]
fn the_daemon_modes_are_off_without_the_opt_in() {
    for args in [
        &["--serve", "/nonexistent/engine.sock"][..],
        &["--oneshot"],
        &["--mcp"],
    ] {
        // When
        let output = Command::new(BINARY)
            .args(args)
            .output()
            .expect("engine runs");
        // Then
        assert_eq!(output.status.code(), Some(2), "{args:?}");
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(stderr.contains("--enable-daemon"), "{args:?}: {stderr}");
    }
}

#[test]
fn every_entry_mode_is_refused_when_disclaimed() {
    let dir = tempfile::tempdir().expect("temp dir");
    let socket = dir.path().join("e.sock");
    let socket = socket.to_str().expect("utf-8 path");
    let modes: [&[&str]; 9] = [
        &["--stdio"],
        &["--cursor-overlay"],
        &["--schema"],
        &["--selftest"],
        &["--resume", "--endpoint", socket],
        &["--enable-daemon", "--serve", socket],
        &["--enable-daemon", "--oneshot", "--endpoint", socket],
        &["--enable-daemon", "--mcp", "--endpoint", socket],
        &["--serve", socket],
    ];
    for mode in modes {
        // When
        let exit = spawn_engine_with(true, mode);
        // Then
        assert_ne!(exit.code, 0, "{mode:?}: {}", exit.stderr);
        assert!(
            exit.stderr.contains("own responsible process"),
            "{mode:?}: {}",
            exit.stderr
        );
        assert!(
            !std::path::Path::new(socket).exists(),
            "{mode:?} created the daemon socket"
        );
    }
}
