//! Row 49: `apps.list` and `apps.open` on X11 resolve through the XDG desktop-entry resolver: the
//! `applications/*.desktop` files of the XDG data directories, the first directory winning.

use std::path::PathBuf;

/// One launchable application.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct App {
    /// The desktop-file id (`org.gnome.gedit.desktop`).
    pub id: String,
    pub name: String,
    /// The `Exec` line with its field codes removed, split into argv.
    pub argv: Vec<String>,
}

/// The applications of `data_dirs` (`$XDG_DATA_HOME` first, then `$XDG_DATA_DIRS`).
#[must_use]
pub fn list(data_dirs: &[PathBuf]) -> Vec<App> {
    let _ = data_dirs;
    Vec::new()
}

/// The argv that opens the application `id`.
#[must_use]
pub fn open_argv(apps: &[App], id: &str) -> Option<Vec<String>> {
    let _ = (apps, id);
    None
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{list, open_argv};

    #[test]
    fn x11_apps_list_and_open_resolve_through_the_xdg_resolver() {
        let root = std::env::temp_dir().join(format!("omo-x11-apps-{}", std::process::id()));
        let (home, system) = (root.join("home"), root.join("system"));
        for (dir, exec) in [(&home, "gedit --new-window %U"), (&system, "gedit-system %F")] {
            fs::create_dir_all(dir.join("applications")).expect("dir");
            fs::write(
                dir.join("applications/org.gnome.gedit.desktop"),
                format!("[Desktop Entry]\nType=Application\nName=Text Editor\nExec={exec}\n"),
            )
            .expect("entry");
        }
        let apps = list(&[home, system]);
        assert_eq!(apps.len(), 1, "one id, the first data directory wins: {apps:?}");
        assert_eq!(apps[0].name, "Text Editor");
        assert_eq!(
            open_argv(&apps, "org.gnome.gedit.desktop"),
            Some(vec!["gedit".to_owned(), "--new-window".to_owned()])
        );
        assert_eq!(open_argv(&apps, "missing.desktop"), None);
        let _ = fs::remove_dir_all(&root);
    }
}
