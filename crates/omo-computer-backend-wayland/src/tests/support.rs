//! Shared test setup: keymaps, a fake EIS server in a private directory, and backends wired to
//! it on the socket route or through the fake portal.

use std::path::PathBuf;
use std::time::Duration;

use omo_computer_core::backend::{Backend, InputEvent, TaggedInput};
use omo_computer_core::capabilities::CompositorName;

use crate::fake::{FakeEis, FakePortal, FakeRegion, Mode, Script};
use crate::ledger::Ledger;
use crate::{InputRoute, Options, WaylandBackend};

pub const US: &str = include_str!("../../testdata/us.xkb");
pub const FR: &str = include_str!("../../testdata/fr.xkb");
pub const US_FR: &str = include_str!("../../testdata/us-fr.xkb");

/// Two outputs side by side, as SP-W measured on GNOME.
pub const TWO_OUTPUTS: [FakeRegion; 2] = [
    FakeRegion {
        x: 0,
        y: 0,
        width: 1280,
        height: 800,
    },
    FakeRegion {
        x: 1280,
        y: 0,
        width: 1024,
        height: 768,
    },
];

pub struct Rig {
    pub dir: tempfile::TempDir,
    pub eis: FakeEis,
}

impl Rig {
    pub fn new(keymap: &str, mode: Mode) -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let script = Script {
            keymap: keymap.to_owned(),
            regions: TWO_OUTPUTS.to_vec(),
            mode,
            keyboard: true,
        };
        let eis = FakeEis::start(dir.path(), script).expect("fake EIS binds");
        Self { dir, eis }
    }

    pub fn socket_backend(&self, compositor: CompositorName) -> WaylandBackend {
        WaylandBackend::new(options(
            compositor,
            InputRoute::Socket(self.eis.socket().to_owned()),
            self.state_file(),
        ))
    }

    pub fn portal_backend(
        &self,
        compositor: CompositorName,
        portal: &FakePortal,
    ) -> WaylandBackend {
        WaylandBackend::new(options(
            compositor,
            InputRoute::Portal(Box::new(portal.client())),
            self.state_file(),
        ))
    }

    pub fn portal(&self) -> FakePortal {
        FakePortal::new(self.eis.socket())
    }

    pub fn state_file(&self) -> PathBuf {
        self.dir.path().join("wayland-consent.json")
    }
}

pub fn options(compositor: CompositorName, route: InputRoute, state_file: PathBuf) -> Options {
    Options {
        compositor,
        route,
        ledger: Ledger::shipped(),
        persist_consent: false,
        consent_file: state_file,
        clipboard: None,
    }
}

pub fn key(name: &str, down: bool) -> TaggedInput {
    TaggedInput {
        event: InputEvent::Key {
            key: name.to_owned(),
            down,
        },
        tag: 7,
    }
}

pub fn text(value: &str) -> TaggedInput {
    TaggedInput {
        event: InputEvent::Text(value.to_owned()),
        tag: 7,
    }
}

pub fn send(
    backend: &mut WaylandBackend,
    input: &TaggedInput,
) -> Result<omo_computer_core::backend::Delivered, omo_computer_core::backend::Refusal> {
    backend.post_input(input, omo_computer_core::backend::Route::ForegroundHid)
}

pub const SETTLE: Duration = Duration::from_secs(3);
