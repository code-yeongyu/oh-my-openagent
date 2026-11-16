//! `apps.list()` / `apps.open()` through the XDG desktop entries of `XDG_DATA_HOME` and
//! `XDG_DATA_DIRS`: each entry reported with `source:"xdg_entry"`, the `Exec` line parsed
//! through both of its escaping layers, a shell operator refused with nothing launched, and
//! the child started directly, never through a shell command line. Both Linux display
//! backends answer the two verbs from this resolver.

pub mod entry;
pub mod exec;
pub mod launch;

use std::collections::BTreeMap;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::{AppInfo, AppSource};
use omo_computer_core::untrusted::UntrustedText;

use crate::backend::AtspiBackend;
use crate::bus::Bus;
use crate::types::AxRefusal;
use entry::DesktopEntry;
use launch::{child_env, LaunchPlan, Launcher};

impl<B: Bus> AtspiBackend<B> {
    /// The launchable entries by desktop id; the first directory in XDG precedence wins.
    fn entries(&mut self) -> BTreeMap<String, DesktopEntry> {
        let files = self
            .bus
            .as_mut()
            .map(|bus| bus.desktop_files())
            .unwrap_or_default();
        let mut found = BTreeMap::new();
        for (path, contents) in files {
            if let Some(entry) = DesktopEntry::parse(&path, &contents) {
                found.entry(entry.id.clone()).or_insert(entry);
            }
        }
        found
    }

    /// Every launchable XDG entry, by app key.
    pub fn apps_list(&mut self) -> Vec<AppInfo> {
        self.entries()
            .into_values()
            .map(|entry| AppInfo {
                app_key: entry.id,
                name: entry.name,
                pid: None,
                running: false,
                source: AppSource::XdgEntry,
                path: Some(entry.path.display().to_string()),
                identity: None,
                observation: UntrustedText,
            })
            .collect()
    }

    /// Launches the entry `app_key` names through `launcher` and answers the child's pid.
    ///
    /// # Errors
    /// An unknown key (`InvalidTarget{app_unknown}`), an `Exec` the parser refuses
    /// (`Internal{launch_needs_user}`, nothing launched), or a failed spawn (`Internal`).
    pub fn apps_open(
        &mut self,
        app_key: &str,
        launcher: &mut dyn Launcher,
    ) -> Result<u32, AxRefusal> {
        let entry = self.entries().remove(app_key).ok_or_else(|| {
            AxRefusal::plain(Refusal::new(EngineCode::InvalidTarget, Reason::AppUnknown))
        })?;
        let argv = exec::argv(&entry.exec).map_err(|_| {
            AxRefusal::plain(Refusal::new(EngineCode::Internal, Reason::LaunchNeedsUser))
        })?;
        let (program, args) = argv.split_first().ok_or_else(|| {
            AxRefusal::plain(Refusal::new(EngineCode::Internal, Reason::LaunchNeedsUser))
        })?;
        let plan = LaunchPlan {
            program: program.clone(),
            args: args.to_vec(),
            env: child_env(std::env::vars()),
        };
        launcher
            .launch(&plan)
            .map_err(|_| AxRefusal::plain(Refusal::bare(EngineCode::Internal)))
    }
}
