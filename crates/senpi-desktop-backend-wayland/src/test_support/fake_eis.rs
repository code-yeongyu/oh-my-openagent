//! A fake EIS server built on `reis::eis` (the server half of the libei
//! protocol) that announces a keyboard with a textual XKB keymap and an
//! absolute pointer over a 1920x1080 region (or the regions a test asks
//! for), then records every emulated event the client sends.

use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;

use reis::request::{Connection, Device, Seat};

use super::HANG_GUARD;
use crate::capture::layout::EisRegion;

#[path = "fake_eis/protocol.rs"]
mod protocol;

use protocol::{add_pointer, serve};

const DEFAULT_REGION: EisRegion = EisRegion {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scale: 1.0,
};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Recorded {
    Key { keycode: u32, pressed: bool },
    Button { code: u32, pressed: bool },
    Motion { x: f32, y: f32 },
}

#[derive(Debug, Default, Clone)]
pub struct Log {
    pub connected: bool,
    pub events: Vec<Recorded>,
    /// `stop_emulating` requests: one per finished client burst.
    pub bursts: usize,
    pub continuous_scroll: Vec<(f32, f32)>,
    pub discrete_scroll: Vec<(i32, i32)>,
    pub error: Option<String>,
}

/// The keymap the keyboard announces and the XKB group it reports active.
#[derive(Clone, Copy)]
pub struct EisConfig {
    pub keymap: &'static str,
    pub group: u32,
}

#[derive(Clone, Copy)]
pub enum DeviceTopology {
    BothSameSeat,
    PointerOnly,
    SplitSeats,
}

type Shared = Arc<(Mutex<Log>, Condvar)>;
type SharedDevices = Arc<(Mutex<Devices>, Condvar)>;

#[derive(Default)]
struct Devices {
    connection: Option<Connection>,
    pointer: Option<Device>,
    pointer_seat: Option<Seat>,
}

pub struct FakeEis {
    log: Shared,
    devices: SharedDevices,
}

impl FakeEis {
    /// Serves the one client that connects to `listener`.
    pub fn listen(listener: UnixListener, config: EisConfig) -> Self {
        Self::listen_with_topology(listener, config, DeviceTopology::BothSameSeat)
    }

    pub fn listen_with_topology(
        listener: UnixListener,
        config: EisConfig,
        topology: DeviceTopology,
    ) -> Self {
        Self::spawn(config, topology, vec![DEFAULT_REGION], move || {
            listener.accept().map(|(stream, _)| stream)
        })
    }

    /// Serves one client whose absolute pointer covers `regions`.
    pub fn listen_with_regions(listener: UnixListener, config: EisConfig, regions: Vec<EisRegion>) -> Self {
        Self::spawn(config, DeviceTopology::BothSameSeat, regions, move || {
            listener.accept().map(|(stream, _)| stream)
        })
    }

    /// Serves `stream` (the server end of a `ConnectToEIS` socket pair).
    pub fn serve(stream: UnixStream, config: EisConfig) -> Self {
        Self::spawn(config, DeviceTopology::BothSameSeat, vec![DEFAULT_REGION], move || Ok(stream))
    }

    fn spawn(
        config: EisConfig,
        topology: DeviceTopology,
        regions: Vec<EisRegion>,
        accept: impl FnOnce() -> std::io::Result<UnixStream> + Send + 'static,
    ) -> Self {
        let log: Shared = Arc::default();
        let devices: SharedDevices = Arc::default();
        let served = Arc::clone(&log);
        let controlled = Arc::clone(&devices);
        thread::spawn(move || {
            let outcome = accept()
                .map_err(|error| error.to_string())
                .and_then(|stream| {
                    update(&served, |log| log.connected = true);
                    tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .map_err(|error| error.to_string())?
                        .block_on(serve(stream, config, topology, &regions, &served, &controlled))
                });
            if let Err(error) = outcome {
                update(&served, |log| log.error = Some(error));
            }
        });
        Self { log, devices }
    }

    /// Blocks until `ready` holds for the log, bounded by the hang guard.
    pub fn wait_for(&self, ready: impl Fn(&Log) -> bool) -> Log {
        let (lock, changed) = &*self.log;
        let log = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let (log, waited) = changed
            .wait_timeout_while(log, HANG_GUARD, |log| !ready(log) && log.error.is_none())
            .unwrap_or_else(PoisonError::into_inner);
        assert!(!waited.timed_out(), "fake EIS hang guard expired: {log:?}");
        log.clone()
    }

    pub fn pause_pointer(&self) {
        self.control_pointer(Device::paused);
    }

    pub fn remove_pointer(&self) {
        self.control_pointer(Device::remove);
    }

    /// Removes the announced pointer and announces a resumed one over
    /// `regions`: the compositor's layout changed.
    pub fn replace_pointer(&self, regions: &[EisRegion]) {
        let (lock, changed) = &*self.devices;
        let devices = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut devices, waited) = changed
            .wait_timeout_while(devices, HANG_GUARD, |devices| devices.pointer.is_none())
            .unwrap_or_else(PoisonError::into_inner);
        assert!(!waited.timed_out(), "fake EIS pointer was never announced");
        devices.pointer.take().expect("announced pointer").remove();
        let seat = devices.pointer_seat.clone().expect("pointer seat");
        devices.pointer = Some(add_pointer(&seat, regions));
        devices
            .connection
            .as_ref()
            .expect("fake EIS connection")
            .flush()
            .expect("flush fake EIS layout change");
    }

    fn control_pointer(&self, action: impl FnOnce(&Device)) {
        let (lock, changed) = &*self.devices;
        let devices = lock.lock().unwrap_or_else(PoisonError::into_inner);
        let (devices, waited) = changed
            .wait_timeout_while(devices, HANG_GUARD, |devices| devices.pointer.is_none())
            .unwrap_or_else(PoisonError::into_inner);
        assert!(!waited.timed_out(), "fake EIS pointer was never announced");
        let pointer = devices.pointer.as_ref().expect("announced pointer");
        action(pointer);
        devices
            .connection
            .as_ref()
            .expect("fake EIS connection")
            .flush()
            .expect("flush fake EIS control event");
    }
}

fn update(shared: &Shared, change: impl FnOnce(&mut Log)) {
    let (lock, changed) = &**shared;
    change(&mut lock.lock().unwrap_or_else(PoisonError::into_inner));
    changed.notify_all();
}
