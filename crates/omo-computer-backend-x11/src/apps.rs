//! Row 49: the X11 backend answers `apps.list()` and `apps.open()` from row 48's XDG resolver
//! (`omo_computer_backend_atspi::apps`): this file is the delegation and nothing else.

use omo_computer_backend_atspi::apps::launch::Launcher;
use omo_computer_backend_atspi::bus::Bus;
use omo_computer_backend_atspi::AtspiBackend;
use omo_computer_core::backend::Refusal;
use omo_computer_core::listing::AppInfo;

/// The resolver the X11 backend forwards the two app verbs to.
pub trait AppResolver: Send {
    fn list(&mut self) -> Vec<AppInfo>;

    /// # Errors
    /// The resolver's refusal, nothing launched.
    fn open(&mut self, app_key: &str, launcher: &mut dyn Launcher) -> Result<u32, Refusal>;
}

impl<B: Bus + Send> AppResolver for AtspiBackend<B> {
    fn list(&mut self) -> Vec<AppInfo> {
        self.apps_list()
    }

    fn open(&mut self, app_key: &str, launcher: &mut dyn Launcher) -> Result<u32, Refusal> {
        self.apps_open(app_key, launcher)
            .map_err(|refused| refused.refusal)
    }
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
