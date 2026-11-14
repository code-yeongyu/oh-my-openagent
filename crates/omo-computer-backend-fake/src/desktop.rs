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

    fn executable_path(&self, pid: u32) -> Option<String> {
        FakeBackend::executable_path(self, pid)
    }

    /// R70av: the fake arms any chord the consent view names (only the stop chord's source is
    /// under test here; a backend's own refusal is the core default's).
    fn set_stop_chord(&mut self, chord: Option<&str>) -> omo_computer_core::backend::BackendResult<()> {
        let refused = chord.is_some_and(|chord| {
            self.lock().scenario.unarmable_stop_chords.iter().any(|c| c.eq_ignore_ascii_case(chord))
        });
        if refused {
            return Err(omo_computer_core::backend::Refusal::new(
                omo_computer_core::error::EngineCode::StopPathUnavailable,
                omo_computer_core::error::Reason::Deaf.wire(),
            ));
        }
        Ok(())
    }

    fn platform(&self) -> Option<omo_computer_core::report::Platform> {
        use omo_computer_core::report::Platform;
        Some(match self.persona {
            crate::Persona::Macos => Platform::Macos,
            crate::Persona::X11 => Platform::X11,
            crate::Persona::Wayland => Platform::Wayland,
            crate::Persona::Win32 => Platform::Windows,
        })
    }

    fn host_consent(&self) -> Option<serde_json::Value> {
        self.scripted_host_consent()
    }

    fn clock(&self) -> Option<&dyn omo_computer_core::backend::BackendClock> {
        Some(&self.clock)
    }

    fn settle_source(&mut self) -> Option<Box<dyn omo_computer_core::backend::SettleSource>> {
        Some(Box::new(crate::settle_source::FakeSettleSource::new(
            self.shared.clone(),
            self.clock.clone(),
        )))
    }
}

#[cfg(test)]
mod extent_tests;
#[cfg(test)]
mod tests;
