//! The AX thread: one `CFRunLoop` on which every target app's `AXObserver` fires (the eleven
//! notifications), each callback attributed to its window by an `AXParent` walk of at most
//! 128 hops and handed to the server over a channel. The server waits on that channel with
//! the caller's deadline: no AX polling and no sleep. The run loop is run in short slices only
//! so a new registration request is picked up.

use std::ffi::{c_void, CString};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};

use super::ffi;
use crate::ax::seam::NOTIFICATIONS;
use crate::capture::os::cf::{self, cf_string, CfRef, Owned};
use crate::capture::os::symbols;

/// Run-loop slice between registration checks.
const RUN_LOOP_SLICE_S: f64 = 0.05;
/// `AXParent` hops before an event is unattributable.
const MAX_PARENT_HOPS: usize = 128;

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
    events: Sender<Raw>,
}

/// The AX thread's two channels.
pub struct ObserverThread {
    register: Sender<u32>,
    pub events: Receiver<Raw>,
}

impl ObserverThread {
    pub fn start() -> Option<Self> {
        let (register, requests) = channel::<u32>();
        let (sink, events) = channel::<Raw>();
        std::thread::Builder::new()
            .name("omo-computer-ax".into())
            .spawn(move || run(&requests, &sink))
            .ok()?;
        Some(Self { register, events })
    }

    pub fn observe(&self, pid: u32) -> bool {
        self.register.send(pid).is_ok()
    }
}

fn run(requests: &Receiver<u32>, sink: &Sender<Raw>) {
    let mut kept: Vec<(Owned, Owned, Box<Refcon>)> = Vec::new();
    loop {
        loop {
            match requests.try_recv() {
                Ok(pid) => kept.extend(add(pid, sink)),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }
        // SAFETY: the default mode constant; runs this thread's own run loop.
        unsafe { ffi::CFRunLoopRunInMode(ffi::kCFRunLoopDefaultMode, RUN_LOOP_SLICE_S, false) };
    }
}

fn add(pid: u32, sink: &Sender<Raw>) -> Option<(Owned, Owned, Box<Refcon>)> {
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
    for name in NOTIFICATIONS {
        let name = cf_string(&CString::new(name).ok()?)?;
        // SAFETY: valid observer, element and name; `refcon` outlives the observer in `kept`.
        unsafe { ffi::AXObserverAddNotification(observer.get(), app.get(), name.get(), pointer) };
    }
    // SAFETY: this thread's run loop and the observer's source.
    unsafe {
        let source = ffi::AXObserverGetRunLoopSource(observer.get());
        ffi::CFRunLoopAddSource(
            ffi::CFRunLoopGetCurrent(),
            source,
            ffi::kCFRunLoopDefaultMode,
        );
    }
    Some((observer, app, refcon))
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
    let _ = refcon.events.send(raw);
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

/// The window number of the `AXWindow` above `element`.
pub fn window_of(element: CfRef) -> Option<u32> {
    let get = symbols::lookup::<GetWindow>(c"_AXUIElementGetWindow")?;
    // SAFETY: retained so the walk owns every step.
    let mut current = Owned::new(unsafe { ffi::CFRetain(element) })?;
    for _ in 0..MAX_PARENT_HOPS {
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
