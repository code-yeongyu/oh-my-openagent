//! `Backend` for the fake: listings, capture and the one input sink, all scripted. Each
//! trait method delegates to the module that owns its behaviour.

use omo_computer_core::backend::{
    Backend, BackendResult, CaptureOptions, Delivered, EpochSource, FrameBytes, PermissionProbe,
    Presence, Route, StopListener, TaggedInput, Target, WindowFilter, WindowList,
};
use omo_computer_core::capabilities::Capabilities;
use omo_computer_core::results::DisplayInfo;

use crate::backend::FakeBackend;

mod capture;
mod geometry;
mod input;
mod listing;
mod session;

pub use capture::MAX_COMPOSITE_PIXELS;

impl Backend for FakeBackend {
    fn capabilities(&self) -> Capabilities {
        self.scripted_capabilities()
    }

    fn windows(&mut self, filter: &WindowFilter) -> BackendResult<WindowList> {
        self.list_windows(filter)
    }

    fn displays(&mut self) -> BackendResult<Vec<DisplayInfo>> {
        self.list_displays()
    }

    fn capture(&mut self, target: &Target, options: &CaptureOptions) -> BackendResult<FrameBytes> {
        self.capture_frame(target, options)
    }

    fn post_input(&mut self, input: &TaggedInput, route: Route) -> BackendResult<Delivered> {
        self.record_input(input, route)
    }

    fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        self.scripted_stop_listener()
    }

    fn probe_permissions(&self) -> PermissionProbe {
        session::granted_permissions()
    }

    fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        self.scripted_epoch_source()
    }

    fn presence(&mut self) -> Option<Box<dyn Presence>> {
        self.scripted_presence()
    }

    fn ax_reader(&mut self) -> Option<&mut dyn omo_computer_core::ax::AxReader> {
        Some(self)
    }

    // --- Row 21: the scripted code identity per pid and the fake host's consent view. ---

    fn code_identity(&self, pid: u32) -> Option<omo_computer_core::listing::CodeIdentity> {
        FakeBackend::code_identity(self, pid)
    }

    fn host_consent(&self) -> Option<serde_json::Value> {
        self.scripted_host_consent()
    }

    // --- Row 25: menus, apps, system surfaces and the focused web area's URL. ---

    fn shell_reader(&mut self) -> Option<&mut dyn omo_computer_core::surface::ShellReader> {
        Some(self)
    }
}

mod shell;

#[cfg(test)]
mod extent_tests;
#[cfg(test)]
mod tests;