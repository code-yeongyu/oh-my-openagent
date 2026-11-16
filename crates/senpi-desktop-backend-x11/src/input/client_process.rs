//! What `/proc` shows about the local process behind a window: the shared
//! objects it has mapped, its arguments, the binary its `exe` link resolves
//! to (which names an xterm run under another name), and whether it runs
//! Chromium helper children. `WM_CLASS` is chosen by the application and
//! often names no toolkit (a GTK app run from `fixture.py` is `Fixture.py`),
//! so whether a window accepts synthetic input is read from the process
//! instead.

use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClientProcess {
    /// File names of the mapped shared objects, e.g. `libgtk-3.so.0`.
    pub libraries: Vec<String>,
    /// `argv` as `/proc/<pid>/cmdline` lists it.
    pub args: Vec<String>,
    /// What `/proc/<pid>/exe` resolves to, e.g. `/usr/bin/xterm`; `None` when
    /// the link cannot be read.
    pub exe: Option<String>,
    /// Whether a child runs with Chromium's `--type=` helper argument
    /// (Chromium and Electron link their toolkit statically).
    pub chromium_helpers: bool,
}

impl ClientProcess {
    /// Reads process `pid` under `proc_root` (`/proc` outside tests).
    ///
    /// # Errors
    /// Why the process cannot be read: it exited, or belongs to another user.
    pub fn read(proc_root: &Path, pid: u32) -> Result<Self, String> {
        let dir = proc_root.join(pid.to_string());
        let maps = fs::read_to_string(dir.join("maps"))
            .map_err(|error| format!("/proc/{pid}/maps is unreadable ({error})"))?;
        let mut libraries: Vec<String> = maps
            .lines()
            .filter_map(|line| line.split_whitespace().nth(5))
            .filter_map(|path| path.rsplit('/').next())
            .filter(|name| name.contains(".so"))
            .map(str::to_owned)
            .collect();
        libraries.sort_unstable();
        libraries.dedup();
        let args = read_args(&dir.join("cmdline"))
            .ok_or_else(|| format!("/proc/{pid}/cmdline is unreadable"))?;
        let chromium_helpers = children(&dir).into_iter().any(|child| {
            read_args(&proc_root.join(child).join("cmdline"))
                .is_some_and(|args| args.iter().any(|arg| arg.starts_with("--type=")))
        });
        let exe = fs::read_link(dir.join("exe"))
            .ok()
            .map(|path| path.to_string_lossy().trim_end_matches(" (deleted)").to_owned());
        Ok(Self {
            libraries,
            args,
            exe,
            chromium_helpers,
        })
    }
}

fn read_args(path: &Path) -> Option<Vec<String>> {
    let raw = fs::read(path).ok()?;
    Some(
        raw.split(|&byte| byte == 0)
            .filter(|arg| !arg.is_empty())
            .map(|arg| String::from_utf8_lossy(arg).into_owned())
            .collect(),
    )
}

/// The child pids every thread of the process lists in `task/*/children`;
/// none when the kernel does not publish them.
fn children(dir: &Path) -> Vec<String> {
    let Ok(tasks) = fs::read_dir(dir.join("task")) else {
        return Vec::new();
    };
    tasks
        .filter_map(Result::ok)
        .filter_map(|task| fs::read_to_string(task.path().join("children")).ok())
        .flat_map(|list| list.split_whitespace().map(str::to_owned).collect::<Vec<_>>())
        .collect()
}
