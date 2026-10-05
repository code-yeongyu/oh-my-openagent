#![cfg(target_os = "linux")]

//! Shared Linux AT-SPI accessibility backend for the X11 and Wayland
//! backends: pure Rust over `atspi` + `zbus`, never libatspi. Backends hold
//! it as `AtSpiAx::new(..).ok()`, so a missing accessibility bus reports
//! `ax: false` instead of failing the backend.

mod actions;
mod apps;
mod bus;
mod connection;
mod live;
mod owner;
mod permission;
mod props;
mod text;

use senpi_desktop_core::ax::{AxBackend, AxHandle, AxOwner, AxProps};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::types::DesktopWindow;

pub use bus::{AtSpiBus, BusResult, Extents, ScreenPoint};
pub use connection::LiveBus;
pub use permission::AxPermission;

pub const BACKEND_NAME: &str = env!("CARGO_PKG_NAME");

/// The id space of the host backend's `windows()`, fixed at construction:
/// it decides whether an element's frame names its window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowIds {
    /// `windows()` lists AT-SPI frames by object id (Wayland).
    AtSpiFrames,
    /// `windows()` lists native ids AT-SPI cannot name (X11 XIDs): a frame
    /// is joined to one by pid, title and geometry (`owner::correlate_owner`).
    Native,
}

/// The AT-SPI accessibility backend. Handles wrap `B::Node` in core's
/// session-thread `AxHandle::Native`.
pub struct AtSpiAx<B: AtSpiBus = LiveBus> {
    bus: B,
    window_ids: WindowIds,
}

impl AtSpiAx<LiveBus> {
    /// Connects to the accessibility bus; fails when there is none.
    pub fn new(window_ids: WindowIds) -> CoreResult<Self> {
        LiveBus::connect().map(|bus| Self {
            bus,
            window_ids,
        })
    }
}

impl<B: AtSpiBus> AtSpiAx<B> {
    /// A backend over `bus` for a host with native window ids
    /// (`WindowIds::Native`).
    pub const fn with_bus(bus: B) -> Self {
        Self {
            bus,
            window_ids: WindowIds::Native,
        }
    }

    /// Top-level frames as windows: the Wayland window list, where the
    /// compositor exposes none.
    pub fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        apps::windows(&mut self.bus)
    }

    /// Re-reads the registry, so enabling a toolkit later turns `granted` on.
    pub fn permission(&mut self) -> AxPermission {
        AxPermission::from_applications(self.bus.applications().map(|apps| apps.len()))
    }

    fn node(handle: &AxHandle) -> CoreResult<&B::Node> {
        handle
            .downcast_native::<B::Node>()
            .ok_or_else(|| DesktopError::ax_failed("AT-SPI backend received a non-AT-SPI handle"))
    }
}

impl<B: AtSpiBus> AxBackend for AtSpiAx<B> {
    fn window_root(&mut self, win: &DesktopWindow) -> CoreResult<AxHandle> {
        apps::window_root(&mut self.bus, win).map(AxHandle::native)
    }

    fn props(&mut self, h: &AxHandle) -> CoreResult<AxProps> {
        props::read_props(&mut self.bus, Self::node(h)?)
    }

    fn children(&mut self, h: &AxHandle) -> CoreResult<Vec<AxHandle>> {
        let children = self
            .bus
            .children(Self::node(h)?)
            .map_err(DesktopError::ax_failed)?;
        Ok(children
            .into_iter()
            .filter(|child| !self.bus.is_null(child))
            .map(AxHandle::native)
            .collect())
    }

    fn parent(&mut self, h: &AxHandle) -> CoreResult<Option<AxHandle>> {
        let parent = self.bus.parent(Self::node(h)?).map_err(DesktopError::ax_failed)?;
        Ok((!self.bus.is_null(&parent)).then(|| AxHandle::native(parent)))
    }

    fn perform(&mut self, h: &AxHandle, action: &str) -> CoreResult<()> {
        actions::perform(&mut self.bus, Self::node(h)?, action)
    }

    fn set_value(&mut self, h: &AxHandle, value: &str) -> CoreResult<()> {
        text::set_value(&mut self.bus, Self::node(h)?, value)
    }

    fn focus(&mut self, h: &AxHandle) -> CoreResult<()> {
        actions::focus(&mut self.bus, Self::node(h)?)
    }

    fn element_at(&mut self, x: f64, y: f64) -> CoreResult<Option<AxHandle>> {
        apps::element_at(&mut self.bus, x, y).map(|found| found.map(AxHandle::native))
    }

    fn focused_element(&mut self) -> CoreResult<Option<AxHandle>> {
        apps::focused_element(&mut self.bus).map(|found| found.map(AxHandle::native))
    }

    fn attributes(&mut self, h: &AxHandle) -> CoreResult<Vec<(String, String)>> {
        props::attributes(&mut self.bus, Self::node(h)?)
    }

    /// The element's frame: its object id when `windows()` lists frames,
    /// else the one native window in `windows` it provably is.
    fn owner(&mut self, h: &AxHandle, windows: &[DesktopWindow]) -> CoreResult<AxOwner> {
        let Some(frame) = apps::frame_of(&mut self.bus, Self::node(h)?)? else {
            return Ok(AxOwner::Unknown);
        };
        let id = match self.window_ids {
            WindowIds::AtSpiFrames => Some(self.bus.object_id(&frame)),
            WindowIds::Native => owner::native_owner(&mut self.bus, &frame, windows)?,
        };
        Ok(id.map_or(AxOwner::Unknown, AxOwner::Window))
    }
}

#[cfg(test)]
mod action_tests;
#[cfg(test)]
mod fake;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod owner_correlate_tests;
#[cfg(test)]
mod owner_tests;
#[cfg(test)]
mod tests;
