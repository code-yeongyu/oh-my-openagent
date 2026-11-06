//! Kernel exit ordering (omo#10391, design v4.2 R2 and R6): on a job this test owns, with the root image H spawns in
//! the done-latency row (a console process, so its conhost joins too), each job message is stamped at dequeue
//! together with the job's `ActiveProcesses` and the member's handle state, read before anything else runs; each
//! member's handle signal is stamped with the count read at once, and a poller stamps every count change. H re-reads
//! F's count after a member's handle signals, for at most its 20 ms settle bound, so the row asserts the count drops
//! within that bound of each signal.
#![cfg(windows)]

mod support;

use std::collections::HashMap;
use std::ptr::null_mut;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use support::observer::Observer;
use support::owned_job::{kernel_job, spawn_into, KernelJob};
use support::timeline::{member_label, Timeline};
use support::win::{last_error, Owned};
use support::{example, job, process, unique, Receipt};
use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
use windows_sys::Win32::System::SystemServices::{
    JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS, JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO,
    JOB_OBJECT_MSG_EXIT_PROCESS, JOB_OBJECT_MSG_NEW_PROCESS,
};
use windows_sys::Win32::System::Threading::WaitForSingleObject;
use windows_sys::Win32::System::IO::GetQueuedCompletionStatus;

const ITERATIONS: usize = 20;
const BOUND: Duration = Duration::from_secs(30);
/// H's `SETTLE` (src/run.rs).
const SETTLE: Duration = Duration::from_millis(20);

fn message_name(message: u32) -> String {
    match message {
        JOB_OBJECT_MSG_NEW_PROCESS => "NEW_PROCESS".into(),
        JOB_OBJECT_MSG_EXIT_PROCESS => "EXIT_PROCESS".into(),
        JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS => "ABNORMAL_EXIT_PROCESS".into(),
        JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => "ACTIVE_PROCESS_ZERO".into(),
        other => format!("msg-{other}"),
    }
}

struct Dequeued {
    message: u32,
    active: Option<u32>,
    signaled: Option<bool>,
}

type Members = Arc<Mutex<HashMap<u32, Owned>>>;

fn is_exit(message: u32) -> bool {
    matches!(
        message,
        JOB_OBJECT_MSG_EXIT_PROCESS | JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS
    )
}

/// Dequeues until ACTIVE_PROCESS_ZERO or a 30 s silence, reading the count and the member's handle state first.
fn drain(job: &Owned, port: &Owned, members: &Members, timeline: &Timeline) -> Vec<Dequeued> {
    let mut dequeued = Vec::new();
    loop {
        let (mut message, mut key, mut overlapped) = (0u32, 0usize, null_mut());
        // SAFETY: all three out-parameters are writable locals.
        let ok = unsafe {
            GetQueuedCompletionStatus(port.raw(), &mut message, &mut key, &mut overlapped, 30_000)
        } != 0;
        if !ok {
            timeline.mark(format!("port wait ended {}", last_error()));
            return dequeued;
        }
        let active = job::accounting(job.raw()).map(|info| info.ActiveProcesses);
        let pid = u32::try_from(overlapped.addr()).unwrap_or(0);
        let signaled = members.lock().expect("members").get(&pid).map(|handle| {
            // SAFETY: a zero-timeout wait on a live process handle.
            unsafe { WaitForSingleObject(handle.raw(), 0) == WAIT_OBJECT_0 }
        });
        timeline.mark(format!(
            "msg {} pid {pid} active {active:?} signaled {signaled:?}",
            message_name(message)
        ));
        dequeued.push(Dequeued {
            message,
            active,
            signaled,
        });
        if message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO {
            return dequeued;
        }
    }
}

type Signal = Option<(Duration, Option<u32>)>;

fn watch_with_count(
    kernel: &Arc<KernelJob>,
    timeline: &Arc<Timeline>,
    handle: Owned,
    label: String,
) -> JoinHandle<Signal> {
    let (kernel, timeline) = (Arc::clone(kernel), Arc::clone(timeline));
    std::thread::spawn(move || {
        process::signaled_within(handle.raw(), BOUND).then(|| {
            let active = job::accounting(kernel.job.raw()).map(|info| info.ActiveProcesses);
            let at = timeline.mark(format!("{label} signaled active {active:?}"));
            (at, active)
        })
    })
}

type Change = (Duration, u32);

fn poll_count(kernel: &Arc<KernelJob>, timeline: &Arc<Timeline>) -> JoinHandle<Vec<Change>> {
    let (kernel, timeline) = (Arc::clone(kernel), Arc::clone(timeline));
    std::thread::spawn(move || {
        let (mut changes, mut last) = (Vec::new(), None);
        let deadline = Instant::now() + BOUND;
        while Instant::now() < deadline {
            let Some(active) = job::accounting(kernel.job.raw()).map(|info| info.ActiveProcesses)
            else {
                break;
            };
            if last != Some(active) {
                changes.push((timeline.mark(format!("count {active}")), active));
                last = Some(active);
            }
            if active == 0 {
                break;
            }
            std::thread::yield_now();
        }
        changes
    })
}

/// For the k-th signal in observed order (every earlier member had signaled before its read), whether the count
/// still included the member at the signal, and how long after the signal the count first read `members - k` or less.
fn drop_lags(
    signals: &[Signal],
    changes: &[Change],
    members: usize,
) -> Option<Vec<(bool, Duration)>> {
    let mut observed: Vec<(Duration, Option<u32>)> =
        signals.iter().copied().collect::<Option<_>>()?;
    observed.sort_by_key(|(at, _)| *at);
    observed
        .iter()
        .enumerate()
        .map(|(rank, (at, active))| {
            let left = u32::try_from(members.saturating_sub(rank + 1)).unwrap_or(0);
            if active.is_some_and(|active| active <= left) {
                return Some((false, Duration::ZERO));
            }
            changes
                .iter()
                .find(|(_, count)| *count <= left)
                .map(|(dropped, _)| (true, dropped.saturating_sub(*at)))
        })
        .collect()
}

#[derive(Default)]
struct Tally {
    exits: usize,
    stale: usize,
    unsignaled: usize,
    signals: usize,
    stale_signals: usize,
    max_lag: Duration,
}

#[test]
fn kernel_member_exit_messages_against_the_active_count() {
    let mut receipt = Receipt::new("kernel exit ordering");
    let mut tally = Tally::default();
    for index in 0..ITERATIONS {
        let kernel = Arc::new(kernel_job());
        let suffix = unique("kernel-exit");
        let observer = Observer::start(&suffix, None);
        let timeline = Timeline::new();
        let members: Members = Arc::new(Mutex::new(HashMap::new()));
        let drainer = {
            let (kernel, members, timeline) = (
                Arc::clone(&kernel),
                Arc::clone(&members),
                Arc::clone(&timeline),
            );
            std::thread::spawn(move || drain(&kernel.job, &kernel.port, &members, &timeline))
        };
        let (_root, root_pid) =
            spawn_into(kernel.job.raw(), &example("testkit_blocker"), &[&suffix]);
        assert!(
            observer.wait_for(1, BOUND),
            "iteration {index}: root never connected"
        );
        let (mut waiters, mut labels) = (Vec::new(), Vec::new());
        for pid in job::pid_list(kernel.job.raw()) {
            let (Some(watched), Some(probe)) = (
                process::open(pid, process::WATCH),
                process::open(pid, process::WATCH),
            ) else {
                labels.push(format!("{pid}:unopenable"));
                continue;
            };
            let label = member_label(watched.raw(), pid);
            labels.push(label.clone());
            members.lock().expect("members").insert(pid, probe);
            waiters.push(watch_with_count(&kernel, &timeline, watched, label));
        }
        let poller = poll_count(&kernel, &timeline);
        let release = timeline.mark("release");
        observer.stop();
        let dequeued = drainer.join().expect("drainer");
        let signals: Vec<Signal> = waiters
            .into_iter()
            .map(|waiter| waiter.join().expect("waiter"))
            .collect();
        let changes = poller.join().expect("poller");
        let member_count = members.lock().expect("members").len();
        let lags = drop_lags(&signals, &changes, member_count);
        tally.signals += signals.len();
        for (stale, lag) in lags.iter().flatten() {
            tally.stale_signals += usize::from(*stale);
            tally.max_lag = tally.max_lag.max(*lag);
        }
        let mut seen = 0usize;
        for entry in dequeued.iter().filter(|entry| is_exit(entry.message)) {
            seen += 1;
            let expected = u32::try_from(member_count.saturating_sub(seen)).unwrap_or(0);
            tally.stale += usize::from(entry.active.is_some_and(|active| active > expected));
            tally.unsignaled += usize::from(entry.signaled == Some(false));
        }
        tally.exits += seen;
        receipt.line(format!(
            "iter {index}: root {root_pid}; members {labels:?}; timeline: {}",
            timeline.render(release)
        ));
        assert!(
            dequeued
                .last()
                .is_some_and(|entry| entry.message == JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO),
            "iteration {index}: no ACTIVE_PROCESS_ZERO\n{receipt}"
        );
        assert_eq!(
            seen, member_count,
            "iteration {index}: one exit message per member\n{receipt}"
        );
        assert!(
            lags.is_some_and(|lags| lags.iter().all(|(_, lag)| *lag < SETTLE)),
            "iteration {index}: a member signaled and the count did not drop within {SETTLE:?}\n{receipt}"
        );
    }
    receipt.line(format!(
        "summary: {ITERATIONS} iterations; {} member-exit messages; dequeued while ActiveProcesses still counted the \
         member {}; dequeued before the member's handle signaled {}; {} handle signals, {} read while the count \
         still included the member; longest signal-to-drop lag {:?}",
        tally.exits, tally.stale, tally.unsignaled, tally.signals, tally.stale_signals, tally.max_lag
    ));
}
