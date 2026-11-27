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
    let mut apps: Vec<App> = Vec::new();
    for dir in data_dirs {
        let Ok(entries) = std::fs::read_dir(dir.join("applications")) else {
            continue;
        };
        let mut found: Vec<App> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let id = entry.file_name().to_str()?.to_owned();
                let text = std::fs::read_to_string(entry.path()).ok()?;
                std::path::Path::new(&id)
                    .extension()
                    .is_some_and(|ext| ext == "desktop")
                    .then(|| parse(&id, &text))
                    .flatten()
            })
            .filter(|app| apps.iter().all(|known| known.id != app.id))
            .collect();
        found.sort_by(|a, b| a.id.cmp(&b.id));
        apps.extend(found);
    }
    apps
}

/// One desktop entry's `[Desktop Entry]` group; `None` for a hidden or non-application entry.
fn parse(id: &str, text: &str) -> Option<App> {
    let mut in_entry = false;
    let (mut name, mut exec, mut application, mut hidden) = (None, None, false, false);
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        let Some((key, value)) = line.split_once('=').filter(|_| in_entry) else {
            continue;
        };
        match key.trim() {
            "Name" => name = Some(value.trim().to_owned()),
            "Exec" => exec = Some(value.trim().to_owned()),
            "Type" => application = value.trim() == "Application",
            "NoDisplay" | "Hidden" => hidden |= value.trim() == "true",
            _ => {}
        }
    }
    let argv: Vec<String> = exec?
        .split_whitespace()
        .filter(|word| !word.starts_with('%'))
        .map(str::to_owned)
        .collect();
    (application && !hidden && !argv.is_empty()).then(|| App {
        id: id.to_owned(),
        name: name.unwrap_or_else(|| id.to_owned()),
        argv,
    })
}

/// The argv that opens the application `id`.
#[must_use]
pub fn open_argv(apps: &[App], id: &str) -> Option<Vec<String>> {
    apps.iter().find(|app| app.id == id).map(|app| app.argv.clone())
}

#[cfg(test)]
mod tests {
    use omo_computer_backend_atspi::apps::launch::{LaunchPlan, Launcher};
    use omo_computer_backend_atspi::fake::FakeBus;
    use omo_computer_backend_atspi::AtspiBackend;
    use omo_computer_core::backend::Refusal;
    use omo_computer_core::error::{EngineCode, Reason};
    use omo_computer_core::listing::AppSource;

    use super::AppResolver;

    #[derive(Default)]
    struct Recording(Vec<LaunchPlan>);

    impl Launcher for Recording {
        fn launch(&mut self, plan: &LaunchPlan) -> std::io::Result<u32> {
            self.0.push(plan.clone());
            Ok(4100)
        }
    }

    #[test]
    fn x11_apps_list_and_open_resolve_through_the_xdg_resolver() {
        let (mut bus, _handle) = FakeBus::new();
        bus.add_desktop_file(
            "/home/u/.local/share/applications/org.gnome.gedit.desktop",
            "[Desktop Entry]\nType=Application\nName=Text Editor\nExec=\"/opt/My App/gedit\" --new-window %U\n",
        );
        bus.add_desktop_file(
            "/usr/share/applications/org.gnome.gedit.desktop",
            "[Desktop Entry]\nType=Application\nName=System Editor\nExec=gedit-system %F\n",
        );
        let mut resolver: Box<dyn AppResolver> =
            Box::new(AtspiBackend::new(Some(bus), Box::new(Vec::new())));
        let apps = resolver.list();
        assert_eq!(
            apps.len(),
            1,
            "one id, the first data directory wins: {apps:?}"
        );
        assert_eq!(
            (apps[0].name.as_str(), apps[0].source),
            ("Text Editor", AppSource::XdgEntry)
        );
        let mut launcher = Recording::default();
        assert!(
            apps[0].app_key.starts_with("org.gnome.gedit"),
            "keyed by desktop id: {}",
            apps[0].app_key
        );
        assert_eq!(resolver.open(&apps[0].app_key, &mut launcher), Ok(4100));
        assert_eq!(
            launcher.0[0].program, "/opt/My App/gedit",
            "quoted Exec arguments stay whole"
        );
        assert_eq!(
            launcher.0[0].args,
            ["--new-window"],
            "the field code is dropped"
        );
        assert_eq!(
            resolver.open("missing.desktop", &mut launcher),
            Err(Refusal::new(EngineCode::InvalidTarget, Reason::AppUnknown))
        );
        assert_eq!(launcher.0.len(), 1, "nothing launched for an unknown key");
    }
}
