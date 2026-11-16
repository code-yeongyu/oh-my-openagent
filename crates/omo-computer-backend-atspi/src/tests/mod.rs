//! Fixtures shared by the backend's tests: a scripted bus, the host's window list and helpers
//! that observe a window and pick a ref out of the outline.

mod green_extra;
mod live;
mod red_ax;
mod red_session;

use omo_computer_core::backend::{Ref, SnapshotRequest, Target};
use omo_computer_core::params::ObserveOptions;

use crate::bus::NodeId;
use crate::fake::{extents, FakeBus, FakeHandle};
use crate::owner::NativeWindow;
use crate::types::AxRefusal;
use crate::{AtspiBackend, Observation};

pub(crate) const GEDIT_PID: u32 = 4242;
pub(crate) const GEDIT_XID: &str = "0x4000001";
pub(crate) const GEDIT_TITLE: &str = "Untitled - gedit";

pub(crate) struct Fixture {
    pub bus: FakeBus,
    pub handle: FakeHandle,
    pub frame: NodeId,
    pub windows: Vec<NativeWindow>,
}

/// One gedit window: the X11 window and its AT-SPI frame at the same place with the same title.
pub(crate) fn gedit() -> Fixture {
    let (mut bus, handle) = FakeBus::new();
    let app = bus.app(GEDIT_PID, "gedit");
    let frame = bus.node(&app, "frame", GEDIT_TITLE);
    bus.set_extents(&frame, extents(100, 100, 800, 600));
    let windows = vec![NativeWindow {
        id: GEDIT_XID.to_owned(),
        pid: Some(GEDIT_PID),
        app: "gedit".to_owned(),
        title: GEDIT_TITLE.to_owned(),
        bounds: extents(100, 100, 800, 600),
    }];
    Fixture {
        bus,
        handle,
        frame,
        windows,
    }
}

impl Fixture {
    pub(crate) fn backend(self) -> (AtspiBackend<FakeBus>, FakeHandle) {
        (
            AtspiBackend::new(Some(self.bus), Box::new(self.windows)),
            self.handle,
        )
    }
}

pub(crate) fn observe<B: crate::bus::Bus>(
    backend: &mut AtspiBackend<B>,
    window: &str,
) -> Result<Observation, AxRefusal> {
    backend.observe(&SnapshotRequest {
        target: Target::Window(window.to_owned()),
        options: ObserveOptions::default(),
    })
}

/// The ref the outline line labelled `label` carries.
pub(crate) fn ref_of(tree: &str, label: &str) -> Ref {
    let quoted = format!("\"{label}\"");
    let line = tree
        .lines()
        .find(|line| line.contains(&quoted))
        .unwrap_or_else(|| panic!("no line labelled {label} in:\n{tree}"));
    let token = line
        .split("[ref=")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .unwrap_or_else(|| panic!("no ref on {line}"));
    Ref(token.to_owned())
}
