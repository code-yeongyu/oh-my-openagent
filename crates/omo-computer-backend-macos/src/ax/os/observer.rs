//! The AX thread: one `CFRunLoop` on which every target app's `AXObserver` fires (the eleven
//! notifications), each callback attributed to its window by an `AXParent` walk of at most
//! 128 hops inside a 250 ms budget, and handed to the server over a bounded channel. The server
//! waits on that channel with the caller's deadline: no AX polling and no sleep. While the run
//! loop has no live source (no observer kept yet, or every kept app's source invalidated) the
//! thread blocks on the next registration; otherwise it runs the run loop in short slices only
//! so a new registration request is picked up. A registration is settled through
//! [`Registration`]: the caller's answer and the kept set always agree, each AX IPC it makes is
//! bounded by the time the caller still waits, and an already-kept pid is not registered again.

use std::ffi::{c_void, CString};
use std::sync::mpsc::{
    channel, sync_channel, Receiver, Sender, SyncSender, TryRecvError, TrySendError,
};
use std::time::{Duration, Instant};

use super::ffi;
use crate::ax::registration::{Kept, Registration};
use crate::ax::seam::NOTIFICATIONS;
use crate::capture::os::cf::{self, cf_string, CfRef, Owned};
use crate::capture::os::symbols;

/// Run-loop slice between registration checks.
const RUN_LOOP_SLICE_S: f64 = 0.05;
/// `AXParent` hops before an event is unattributable.
const MAX_PARENT_HOPS: usize = 128;
/// The time one event's window attribution may take; a hung app cannot stall the feed longer.
const ATTRIBUTION_BUDGET: Duration = Duration::from_millis(250);
/// Events the feed holds; past that a new one is dropped (the next one wakes the settle).
const EVENT_CAPACITY: usize = 1024;
/// How long a registration request waits for the AX thread's answer.
const REGISTER_WAIT: Duration = Duration::from_secs(1);

type GetWindow = unsafe extern "C" fn(CfRef, *mut u32) -> i32;

/// A retained CF reference moved between threads (CF reference counting is thread-safe).
pub struct SendRef(pub CfRef);

// SAFETY: the reference is +1 and owned by whoever receives it.
unsafe impl Send for SendRef {}

/// One callback as the AX thread saw it.
pub struct Raw {
    pub notification: String,
    pub pid: u32,
    pub element: SendRef,
    pub window: Option<u32>,
}

struct Refcon {
    pid: u32,
    events: SyncSender<Raw>,
}

/// One registration request, settled through its shared [`Registration`].
type Request = (u32, Registration);
/// A kept observer, its application element and the refcon its callbacks read.
type Observer = (Owned, Owned, Box<Refcon>);

/// The AX thread's two channels.
pub struct ObserverThread {
    register: Sender<Request>,
    pub events: Receiver<Raw>,
}

impl ObserverThread {
    pub fn start() -> Option<Self> {
        let (register, requests) = channel::<Request>();
        let (sink, events) = sync_channel::<Raw>(EVENT_CAPACITY);
        std::thread::Builder::new()
            .name("omo-computer-ax".into())
            .spawn(move || run(&requests, &sink))
            .ok()?;
        Some(Self { register, events })
    }

    /// Registers `pid`'s observer; `true` only when the AX thread created it and it took at
    /// least one notification.
    pub fn observe(&self, pid: u32) -> bool {
        let registration = Registration::new(Instant::now() + REGISTER_WAIT);
        self.register.send((pid, registration.clone())).is_ok() && registration.wait()
    }
}

fn run(requests: &Receiver<Request>, sink: &SyncSender<Raw>) {
    let mut kept = Kept::default();
    let mut idle = true;
    loop {
        if idle {
            // No live run-loop source: block on the next request instead of spinning.
            match requests.recv() {
                Ok(request) => register(&mut kept, request, sink),
                Err(_) => return,
            }
        }
        loop {
            match requests.try_recv() {
                Ok(request) => register(&mut kept, request, sink),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        idle = run_slice() == ffi::RUN_LOOP_FINISHED;
    }
}

/// Runs this thread's run loop for one slice; `kCFRunLoopRunFinished` when it has no source.
pub(super) fn run_slice() -> i32 {
    // SAFETY: the default mode constant; runs this thread's own run loop.
    unsafe { ffi::CFRunLoopRunInMode(ffi::kCFRunLoopDefaultMode, RUN_LOOP_SLICE_S, false) }
}

fn register(kept: &mut Kept<Observer>, (pid, registration): Request, sink: &SyncSender<Raw>) {
    let Some((observer, _, _)) = kept.register(pid, &registration, |r| add(pid, r, sink)) else {
        return;
    };
    // SAFETY: this thread's run loop and the kept observer's source; only a kept observer's
    // source is added, so a discarded one never fires.
    unsafe {
        let source = ffi::AXObserverGetRunLoopSource(observer.get());
        ffi::CFRunLoopAddSource(
            ffi::CFRunLoopGetCurrent(),
            source,
            ffi::kCFRunLoopDefaultMode,
        );
    }
}

/// The observer of `pid` on the eleven notifications; `None` when none took or the caller
/// stopped waiting. Each IPC is bounded by the time the caller still waits.
fn add(pid: u32, registration: &Registration, sink: &SyncSender<Raw>) -> Option<Observer> {
    let raw_pid = i32::try_from(pid).ok()?;
    let mut observer: CfRef = std::ptr::null();
    // SAFETY: a valid pid and callback; a success returns a +1 observer.
    if unsafe { ffi::AXObserverCreate(raw_pid, callback, &raw mut observer) } != ffi::AX_SUCCESS {
        return None;
    }
    let observer = Owned::new(observer)?;
    // SAFETY: plain call; +1 application element.
    let app = Owned::new(unsafe { ffi::AXUIElementCreateApplication(raw_pid) })?;
    let refcon = Box::new(Refcon {
        pid,
        events: sink.clone(),
    });
    let pointer = std::ptr::from_ref::<Refcon>(&refcon)
        .cast_mut()
        .cast::<c_void>();
    let mut taken = 0;
    for name in NOTIFICATIONS {
        let left = registration.left()?;
        let name = cf_string(&CString::new(name).ok()?)?;
        // SAFETY: valid observer, element and name; `refcon` outlives the observer in `kept`.
        // The messaging timeout bounds this IPC to the time the caller still waits.
        let code = unsafe {
            ffi::AXUIElementSetMessagingTimeout(app.get(), left.as_secs_f32().max(0.001));
            ffi::AXObserverAddNotification(observer.get(), app.get(), name.get(), pointer)
        };
        taken += usize::from(code == ffi::AX_SUCCESS);
    }
    (taken > 0).then_some((observer, app, refcon))
}

unsafe extern "C" fn callback(
    _observer: CfRef,
    element: CfRef,
    notification: CfRef,
    refcon: *mut c_void,
) {
    // SAFETY: `refcon` is the boxed Refcon registered with this observer.
    let refcon = unsafe { &*refcon.cast::<Refcon>() };
    let raw = Raw {
        notification: cf::string(notification).unwrap_or_default(),
        pid: refcon.pid,
        window: window_of(element),
        // SAFETY: the element is valid for the callback; retained for the receiver.
        element: SendRef(unsafe { ffi::CFRetain(element) }),
    };
    if let Err(TrySendError::Full(dropped) | TrySendError::Disconnected(dropped)) =
        refcon.events.try_send(raw)
    {
        // The feed is full or gone: release the element this event retained.
        drop(Owned::new(dropped.element.0));
    }
}

fn copy(element: CfRef, name: &std::ffi::CStr) -> Option<Owned> {
    let key = cf_string(name)?;
    let mut value: CfRef = std::ptr::null();
    // SAFETY: valid element and key; a success returns a +1 value.
    let status = unsafe { ffi::AXUIElementCopyAttributeValue(element, key.get(), &raw mut value) };
    if status == ffi::AX_SUCCESS {
        Owned::new(value)
    } else {
        None
    }
}

/// The window number of the `AXWindow` above `element`, within [`ATTRIBUTION_BUDGET`].
pub fn window_of(element: CfRef) -> Option<u32> {
    let get = symbols::lookup::<GetWindow>(c"_AXUIElementGetWindow")?;
    let until = Instant::now() + ATTRIBUTION_BUDGET;
    // SAFETY: retained so the walk owns every step.
    let mut current = Owned::new(unsafe { ffi::CFRetain(element) })?;
    for _ in 0..MAX_PARENT_HOPS {
        let left = until.checked_duration_since(Instant::now())?;
        // SAFETY: a valid element; bounds each read of this hop by the time left.
        unsafe {
            ffi::AXUIElementSetMessagingTimeout(current.get(), left.as_secs_f32().max(0.001))
        };
        if copy(current.get(), c"AXRole")
            .and_then(|r| cf::string(r.get()))
            .as_deref()
            == Some("AXWindow")
        {
            let mut number = 0u32;
            // SAFETY: the resolved symbol's signature; `current` is an AXUIElement.
            return (unsafe { get(current.get(), &raw mut number) } == ffi::AX_SUCCESS)
                .then_some(number);
        }
        current = copy(current.get(), c"AXParent")?;
    }
    None
}
