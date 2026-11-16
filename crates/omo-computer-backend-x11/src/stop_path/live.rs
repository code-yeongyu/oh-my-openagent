//! What row 50 adds to the X11 backend, held per backend: the display it arms on, the chord the
//! consent view configured (A-IS-62: there is no default-chord fallback), why the last arm read
//! deaf, the presence overlay, the lease-end signal the raw listener raises, the one epoch
//! source the session polls, and where the self set reads `/proc`.

use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use omo_computer_core::backend::{
    BackendProbes, BackendResult, EpochChange, EpochSource, NoEpochSource, Presence, ProcessTable,
    Refusal, StopListener,
};
use omo_computer_core::capabilities::DeafReason;
use omo_computer_core::error::{EngineCode, Reason};

use super::{arm, deaf, Armed, Hotkey, LeaseEndSignal, Xi2Server};
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
    chord: Option<String>,
    deaf: Option<DeafReason>,
    epoch: Option<SharedEpoch>,
    #[cfg(test)]
    keys: Option<super::fake::FakeKeys>,
    #[cfg(test)]
    epochs: Option<EpochFactory>,
}

/// Opens one epoch source on its own connection.
#[cfg(test)]
pub(crate) type EpochFactory = Box<dyn Fn() -> Option<Box<dyn EpochSource + Send>> + Send>;

/// The backend's one epoch source (review M2): every `epoch_source()` hands out a handle on it,
/// so the layout it compares with survives the session asking for a source again.
#[derive(Clone)]
struct SharedEpoch(Arc<Mutex<Box<dyn EpochSource + Send>>>);

impl EpochSource for SharedEpoch {
    fn next_change(&mut self) -> BackendResult<Option<EpochChange>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).next_change()
    }
}

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
            chord: None,
            deaf: None,
            epoch: None,
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
        let display = self.display.as_deref().ok_or(Refusal::new(EngineCode::StopPathUnavailable, Reason::NoListener))?;
        Xi2Server::connect(display)
            .map(|server| Box::new(server) as Box<dyn super::RawKeyServer>)
            .map_err(|_| Refusal::bare(EngineCode::StopPathUnavailable))
    }

    #[cfg(test)]
    pub(crate) fn with_proc_root(mut self, root: PathBuf) -> Self {
        self.proc_root = root;
        self
    }

    /// The chord the consent view configured (A-IS-62), the only one the listener arms. `None`
    /// clears it: there is no default chord to fall back to.
    ///
    /// # Errors
    /// `StopPathUnavailable{deaf}` for no chord or one that does not parse; nothing is armed.
    pub fn set_chord(&mut self, chord: Option<&str>) -> BackendResult<()> {
        self.chord = chord
            .filter(|chord| Hotkey::parse(chord).is_ok())
            .map(str::to_owned);
        if self.chord.is_some() {
            self.deaf = None;
            Ok(())
        } else {
            self.deaf = Some(DeafReason::ChordUnarmable);
            Err(deaf())
        }
    }

    /// Why the last arm read deaf; `None` before any arm (review L1: capabilities never name a
    /// deaf reason for a stop path nothing has tried to arm).
    #[must_use]
    pub const fn deaf_reason(&self) -> Option<DeafReason> {
        self.deaf
    }

    /// The raw listener for the configured chord on its own connection. A server it cannot be
    /// armed on, or a chord it cannot arm, refuses `deaf` (review L2): the supervisor's slot then
    /// reads deaf at once, never a fresh listener for one call.
    ///
    /// # Errors
    /// `StopPathUnavailable{deaf}` as above; a bare `StopPathUnavailable` when the connection
    /// broke. Broken while polling, the supervisor's ladder re-arms it; unreachable at arm, the
    /// slot reads absent (no seat), which a live host relay covers like any absent listener,
    /// and the next `stopPath.start` arms again (review L2).
    pub fn stop_listener(&mut self) -> BackendResult<Box<dyn StopListener>> {
        let Some(chord) = self.chord.clone() else {
            self.deaf = Some(DeafReason::ChordUnarmable);
            return Err(deaf());
        };
        let server = self.raw_keys()?;
        match arm(server, &chord, self.lease_end.clone()) {
            Ok(Armed::Live(listener)) => {
                self.deaf = None;
                Ok(Box::new(listener))
            }
            Ok(Armed::Deaf(reason)) => {
                if reason == DeafReason::ChordUnarmable {
                    // R70am(4): until a refusal's data can carry it, the chord is named here.
                    eprintln!("omo-computer-backend-x11: stop chord {chord:?} cannot be armed (chord-unarmable)");
                }
                self.deaf = Some(reason);
                Err(deaf())
            }
            Err(_) => Err(Refusal::bare(EngineCode::StopPathUnavailable)),
        }
    }

    pub fn presence(&self) -> Option<Box<dyn Presence>> {
        self.overlay
            .available()
            .then(|| Box::new(self.overlay.clone()) as Box<dyn Presence>)
    }

    /// A handle on the backend's one epoch source, opened on the first call; until a display
    /// answers there is none.
    pub fn epoch_source(&mut self) -> Box<dyn EpochSource> {
        if self.epoch.is_none() {
            self.epoch = self.open_epoch().map(|source| SharedEpoch(Arc::new(Mutex::new(source))));
        }
        self.epoch
            .clone()
            .map_or_else(|| Box::new(NoEpochSource) as Box<dyn EpochSource>, |shared| Box::new(shared))
    }

    fn open_epoch(&self) -> Option<Box<dyn EpochSource + Send>> {
        #[cfg(test)]
        if let Some(epochs) = &self.epochs {
            return epochs();
        }
        let connection = X11Connection::connect(self.display.as_deref()?).ok()?;
        Some(Box::new(X11EpochSource::new(connection)))
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
