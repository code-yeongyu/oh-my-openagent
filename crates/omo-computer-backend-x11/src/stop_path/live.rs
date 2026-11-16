//! What row 50 adds to the X11 backend, held per backend: the display it arms on, the presence
//! overlay, the lease-end signal the raw listener raises, and where the self set reads `/proc`.

use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;

use omo_computer_core::backend::{
    BackendProbes, BackendResult, EpochSource, NoEpochSource, Presence, ProcessTable, Refusal,
    StopListener,
};
use omo_computer_core::error::{EngineCode, Reason};

use super::{arm, Armed, DeafListener, LeaseEndSignal, Xi2Server, DEFAULT_STOP_CHORD};
use crate::capture::X11Connection;
use crate::diagnose::{bus_reach, probes, uinput_at, CompositorRead, HostReads};
use crate::epoch::X11EpochSource;
use crate::overlay::{Overlay, OverlayServer, XOverlay};
use crate::self_set::read_processes;

pub struct Live {
    display: Option<String>,
    pub(crate) overlay: Overlay,
    pub(crate) lease_end: LeaseEndSignal,
    proc_root: PathBuf,
    #[cfg(test)]
    keys: Option<super::fake::FakeKeys>,
    #[cfg(test)]
    epochs: Option<EpochFactory>,
}

/// Opens one epoch source on its own connection.
#[cfg(test)]
pub(crate) type EpochFactory = Box<dyn Fn() -> Option<Box<dyn EpochSource + Send>> + Send>;

impl Live {
    #[must_use]
    pub fn for_display(display: Option<&str>) -> Self {
        let server = display
            .and_then(|display| XOverlay::connect(display).ok())
            .map(|overlay| Box::new(overlay) as Box<dyn OverlayServer>);
        Self {
            display: display.map(str::to_owned),
            overlay: Overlay::new(server),
            lease_end: LeaseEndSignal::default(),
            proc_root: PathBuf::from("/proc"),
            #[cfg(test)]
            keys: None,
            #[cfg(test)]
            epochs: None,
        }
    }

    /// The raw listener arms on `keys` instead of a display.
    #[cfg(test)]
    pub(crate) fn with_keys(mut self, keys: super::fake::FakeKeys) -> Self {
        self.keys = Some(keys);
        self
    }

    /// Epoch sources come from `epochs` instead of a display.
    #[cfg(test)]
    pub(crate) fn with_epochs(mut self, epochs: EpochFactory) -> Self {
        self.epochs = Some(epochs);
        self
    }

    fn raw_keys(&self) -> BackendResult<Box<dyn super::RawKeyServer>> {
        #[cfg(test)]
        if let Some(keys) = &self.keys {
            return Ok(keys.boxed());
        }
        let display = self.display.as_deref().ok_or(Refusal::new(
            EngineCode::StopPathUnavailable,
            Reason::NoListener.wire(),
        ))?;
        Xi2Server::connect(display)
            .map(|server| Box::new(server) as Box<dyn super::RawKeyServer>)
            .map_err(|_| Refusal::bare(EngineCode::StopPathUnavailable))
    }

    #[cfg(test)]
    pub(crate) fn with_proc_root(mut self, root: PathBuf) -> Self {
        self.proc_root = root;
        self
    }

    /// The raw listener on its own connection; a server it cannot be armed on is deaf.
    pub fn stop_listener(&self) -> BackendResult<Box<dyn StopListener>> {
        let server = self.raw_keys()?;
        match arm(server, DEFAULT_STOP_CHORD, self.lease_end.clone()) {
            Ok(Armed::Live(listener)) => Ok(Box::new(listener)),
            Ok(Armed::Deaf(_)) => Ok(Box::new(DeafListener)),
            Err(_) => Err(Refusal::bare(EngineCode::StopPathUnavailable)),
        }
    }

    pub fn presence(&self) -> Option<Box<dyn Presence>> {
        self.overlay
            .available()
            .then(|| Box::new(self.overlay.clone()) as Box<dyn Presence>)
    }

    pub fn epoch_source(&self) -> Box<dyn EpochSource> {
        #[cfg(test)]
        if let Some(epochs) = &self.epochs {
            return epochs().map_or_else(|| Box::new(NoEpochSource) as Box<dyn EpochSource>, |source| source as Box<dyn EpochSource>);
        }
        match self.display.as_deref().map(X11Connection::connect) {
            Some(Ok(connection)) => Box::new(X11EpochSource::new(connection)),
            _ => Box::new(NoEpochSource),
        }
    }

    pub fn processes(&self) -> ProcessTable {
        let uid = std::fs::metadata("/proc/self").map_or(u32::MAX, |meta| meta.uid());
        read_processes(&self.proc_root, uid)
    }

    pub fn diagnose(&self, display: bool, compositor: CompositorRead) -> BackendProbes {
        let at_spi = std::env::var("AT_SPI_BUS_ADDRESS").ok();
        let session = std::env::var("DBUS_SESSION_BUS_ADDRESS").ok();
        probes(HostReads {
            display,
            bus: bus_reach(at_spi.as_deref(), session.as_deref()),
            uinput: uinput_at(std::path::Path::new("/dev/uinput")),
            compositor,
        })
    }
}
