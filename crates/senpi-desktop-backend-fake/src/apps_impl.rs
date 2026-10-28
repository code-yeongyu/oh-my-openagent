//! `apps.list` / `apps.open` over the scenario: the inventory is the scripted
//! `apps` plus one running application per distinct window owner. Opening
//! marks the application running, returns the window it shows, and focuses
//! that window only with `activate`, like a real non-activating launch.

use senpi_desktop_core::apps;
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::protocol_params::{AppsListParams, AppsOpenParams};
use senpi_desktop_core::types::{Application, DesktopWindow, OpenedApplication};

use crate::fake::FakeBackend;
use crate::method::FakeMethod;
use crate::scenario_nodes::FakeApplication;
use crate::sink::SinkOp;

/// Pids handed to scripted applications without one, counted up from here.
const FIRST_LAUNCHED_PID: u32 = 9000;

impl FakeBackend {
    pub(crate) fn apps_list_impl(&mut self, params: &AppsListParams) -> CoreResult<Vec<Application>> {
        self.begin(FakeMethod::AppsList)?;
        Ok(apps::filter(self.inventory(), params))
    }

    pub(crate) fn apps_open_impl(
        &mut self,
        params: &AppsOpenParams,
        check_stop: &dyn Fn() -> CoreResult<()>,
    ) -> CoreResult<OpenedApplication> {
        self.begin(FakeMethod::AppsOpen)?;
        apps::validate(params)?;
        let inventory = self.inventory();
        if apps::route(&inventory, params) == apps::Route::Document {
            return Err(DesktopError::invalid_target(format!(
                "the fake scenario opens applications only; {:?} is a document, URL or reveal", params.id
            )));
        }
        let unlisted = |path: &std::path::Path| {
            Err(DesktopError::invalid_target(format!(
                "application {} is not in the fake scenario", path.display()
            )))
        };
        let application = apps::application(&inventory, &params.id, |_| false, unlisted)?;
        check_stop()?;
        let activate = params.activate.unwrap_or(false);
        let opened = self.launch(application);
        let window = self.shown_window(&opened);
        if activate {
            if let Some(window) = &window {
                let id = window.id.clone();
                self.focus_window(&id);
            }
        }
        self.record(SinkOp::OpenApp { id: opened.id.clone(), activate, reveal: params.reveal.unwrap_or(false) });
        Ok(OpenedApplication::new(opened, window))
    }

    fn inventory(&self) -> Vec<Application> {
        let mut inventory: Vec<Application> = self.apps.iter().map(application).collect();
        for window in &self.windows {
            let path = format!("/Applications/{}.app", window.app);
            if inventory.iter().any(|app| app.path == path) {
                continue;
            }
            inventory.push(Application {
                id: window.app.clone(),
                name: window.app.clone(),
                path,
                running: true,
                pid: window.pid,
            });
        }
        inventory
    }

    /// The scripted application now runs; a first launch takes the next pid.
    fn launch(&mut self, application: Application) -> Application {
        if application.running {
            return application;
        }
        let pid = application.pid.unwrap_or_else(|| {
            FIRST_LAUNCHED_PID + u32::try_from(self.apps.iter().filter(|app| app.running).count()).unwrap_or(0)
        });
        if let Some(scripted) = self.apps.iter_mut().find(|app| app.path == application.path) {
            scripted.running = true;
            scripted.pid = Some(pid);
        }
        Application { running: true, pid: Some(pid), ..application }
    }

    fn shown_window(&self, application: &Application) -> Option<DesktopWindow> {
        let scripted = self.apps.iter().find(|app| app.path == application.path);
        if let Some(id) = scripted.and_then(|app| app.window.as_deref()) {
            return self.window(id).ok().cloned();
        }
        self.windows.iter().find(|window| window.pid.is_some() && window.pid == application.pid).cloned()
    }
}

fn application(app: &FakeApplication) -> Application {
    Application {
        id: app.id.clone(),
        name: app.name.clone(),
        path: app.path.clone(),
        running: app.running,
        pid: app.pid.filter(|_| app.running),
    }
}
