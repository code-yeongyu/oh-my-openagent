use super::*;
use crate::stop_path::chord::{DEFAULT_STOP_CHORD, Hotkey};
use senpi_desktop_safety::{Chord, FakeClock, Supervisor};
use std::sync::{
    Arc, Barrier,
    atomic::{AtomicUsize, Ordering},
    mpsc,
};
use std::{thread, time::Instant};

unsafe extern "C" fn enable(port: CfMachPortRef, enabled: bool) {
    assert!(enabled);
    // SAFETY: the test retains this Cell for the entire synchronous callback.
    let count = unsafe { &*port.cast::<Cell<u32>>() };
    count.set(count.get() + 1);
}

thread_local! {
    /// The `kCGEventSourceUnixProcessID` the fake event reports; 0 is the
    /// hardware (HID) source, anything else a process that posted it.
    static SOURCE_PID: Cell<i64> = const { Cell::new(0) };
}

unsafe extern "C" fn integer_field(_: CgEventRef, field: u32) -> i64 {
    match field {
        KEYCODE_FIELD => 53,
        SOURCE_UNIX_PID_FIELD => SOURCE_PID.with(Cell::get),
        other => panic!("unexpected event field {other}"),
    }
}

unsafe extern "C" fn flags(_: CgEventRef) -> u64 {
    0x001c_0000
}

fn callback(shared: &Shared, kind: u32, enabled: &Cell<u32>) {
    let context = TapContext {
        shared,
        tap: Cell::new(ptr::from_ref(enabled).cast_mut().cast()),
        calls: TapCalls {
            enable,
            integer_field,
            flags,
        },
    };
    let event = ptr::from_ref(enabled).cast_mut().cast();
    assert_eq!(
        tap_callback(
            ptr::null_mut(),
            kind,
            event,
            ptr::from_ref(&context).cast_mut().cast()
        ),
        event,
    );
}

fn shared(supervisor: Arc<Supervisor>) -> Shared {
    Shared::new(
        supervisor,
        Hotkey::parse(&Chord::parse(DEFAULT_STOP_CHORD).unwrap()).unwrap(),
    )
    .unwrap()
}

#[test]
fn a_posted_chord_never_stops_input() {
    // given: the default chord, posted by another process (source pid != 0)
    let shared = shared(Arc::new(Supervisor::new(Arc::new(FakeClock::new(0)))));
    SOURCE_PID.with(|pid| pid.set(4242));
    // when
    callback(&shared, EVENT_KEY_DOWN, &Cell::new(0));
    SOURCE_PID.with(|pid| pid.set(0));
    // then: the in-memory suspension is synchronous, so its absence is final
    assert!(!shared.supervisor.is_suspended(), "a synthetic chord stopped input");
}

#[test]
fn a_physical_chord_stops_input_through_the_callback() {
    // given: the default chord from the hardware source (pid 0)
    let shared = shared(Arc::new(Supervisor::new(Arc::new(FakeClock::new(0)))));
    SOURCE_PID.with(|pid| pid.set(0));
    // when
    callback(&shared, EVENT_KEY_DOWN, &Cell::new(0));
    // then
    assert!(shared.supervisor.is_suspended());
}

#[test]
fn r3_disabled_event_types_reenable_the_tap_through_callback() {
    // given: injected native calls, but the actual registered callback.
    let shared = shared(Arc::new(Supervisor::new(Arc::new(FakeClock::new(0)))));
    let enabled = Cell::new(0);
    let mut control = shared.control.lock();
    // when
    callback(&shared, TAP_DISABLED_BY_TIMEOUT, &enabled);
    callback(&shared, TAP_DISABLED_BY_USER_INPUT, &enabled);
    // then
    assert_eq!(enabled.get(), 2);
    shared.changed.wait_while_for(
        &mut control,
        |control| control.hooks.reenabled.len() < 2,
        Duration::from_millis(50),
    );
    assert_eq!(
        control.hooks.reenabled,
        [TAP_DISABLED_BY_TIMEOUT, TAP_DISABLED_BY_USER_INPUT]
    );
}

#[test]
fn r3_stuck_preparation_cannot_hold_the_callback_or_suspension() {
    // given: the hold really blocks; only teardown can release its preparation.
    let commits = Arc::new(AtomicUsize::new(0));
    let recorded = Arc::clone(&commits);
    let mut supervisor =
        Supervisor::with_stop_commit(Arc::new(FakeClock::new(0)), false, move || {
            recorded.fetch_add(1, Ordering::SeqCst);
        });
    // A stall past the real release budget records the fatal path instead of
    // exiting the whole test binary.
    let exits = Arc::new(AtomicUsize::new(0));
    let exited = Arc::clone(&exits);
    supervisor.set_fatal_exit_for_test(move |_| {
        exited.fetch_add(1, Ordering::SeqCst);
    });
    let supervisor = Arc::new(supervisor);
    let shared = Arc::new(shared(Arc::clone(&supervisor)));
    let signal = supervisor.hold_signal();
    let teardown = Arc::clone(&signal);
    let barrier = Arc::new(Barrier::new(2));
    let (entered, ready) = mpsc::channel();
    let blocked = Arc::clone(&barrier);
    let hold_supervisor = Arc::clone(&supervisor);
    let hold = thread::spawn(move || {
        signal.with_input(&hold_supervisor, || {
            entered.send(()).unwrap();
            blocked.wait();
            Ok(())
        })
    });
    ready.recv_timeout(Duration::from_secs(5)).unwrap();
    let (returned, observed) = mpsc::channel();
    let tapped = Arc::clone(&shared);
    // when: measure inside the callback thread, not scheduler startup latency.
    let tap = thread::spawn(move || {
        let start = Instant::now();
        callback(&tapped, EVENT_KEY_DOWN, &Cell::new(0));
        let elapsed = start.elapsed();
        returned.send(elapsed).unwrap();
        elapsed
    });
    let early = observed.recv_timeout(Duration::from_millis(50));
    let suspended = supervisor.is_suspended();
    let committed = commits.load(Ordering::SeqCst);
    let epoch = supervisor.stop_epoch();
    let fatal = exits.load(Ordering::SeqCst);
    // Teardown runs before assertions even on RED, so a failure cannot strand a thread.
    barrier.wait();
    // A recorded fatal path never publishes the stop; cancel so the scope can return.
    teardown.cancel();
    let elapsed = tap.join().unwrap();
    assert!(hold.join().unwrap().is_err());
    // then
    println!(
        "R3_CALLBACK elapsed_us={} suspended_before_release={suspended}",
        elapsed.as_micros()
    );
    assert!(
        early.is_ok(),
        "tap waited for blocked foreground preparation"
    );
    assert!(elapsed < Duration::from_millis(10), "tap took {elapsed:?}");
    assert!(
        suspended,
        "in-memory refusal waited for foreground preparation"
    );
    assert_eq!(
        fatal, 0,
        "the test stalled past the release budget before observing the callback"
    );
    assert_eq!(committed, 0, "commit ran before physical release");
    assert_eq!(epoch, 0, "stop was published before durable commit");
}
