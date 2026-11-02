//! Kernel exit ordering (omo#10391, design v4.2 R2 and R6): on a job this test owns, with the root image H spawns in
//! the done-latency row (a console process, so its conhost joins too), each job message is stamped at dequeue
//! together with the job's `ActiveProcesses` and the member's handle state, read before anything else runs, and each
//! member's handle signal is stamped with the count read at once. H re-reads F's count on a member's handle signal,
//! so the row asserts the count no longer includes a member whose handle has signaled.
#![cfg(windows)]

mod support;

use std::collections::HashMap;
use std::ptr::null_mut;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

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

/// Signals in observed order: the k-th one read the count after every earlier member had signaled, so a count above
/// `members - k` still included a signaled member.
fn stale_at_signal(signals: &[Signal], members: usize) -> Option<usize> {
    let mut observed: Vec<(Duration, Option<u32>)> =
        signals.iter().copied().collect::<Option<_>>()?;
    observed.sort_by_key(|(at, _)| *at);
    Some(
        observed
            .iter()
            .enumerate()
            .filter(|(rank, (_, active))| {
                let left = u32::try_from(members.saturating_sub(rank + 1)).unwrap_or(0);
                active.is_none_or(|active| active > left)
            })
            .count(),
    )
}

#[derive(Default)]
struct Tally {
    exits: usize,
    stale: usize,
    unsignaled: usize,
    signals: usize,
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
        let release = timeline.mark("release");
        observer.stop();
        let dequeued = drainer.join().expect("drainer");
        let signals: Vec<Signal> = waiters
            .into_iter()
            .map(|waiter| waiter.join().expect("waiter"))
            .collect();
        let member_count = members.lock().expect("members").len();
        let stale_signals = stale_at_signal(&signals, member_count);
        tally.signals += signals.len();
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
        assert_eq!(
            stale_signals,
            Some(0),
            "iteration {index}: a member's handle signaled while the count still included it\n{receipt}"
        );
    }
    receipt.line(format!(
        "summary: {ITERATIONS} iterations; {} member-exit messages; dequeued while ActiveProcesses still counted the \
         member {}; dequeued before the member's handle signaled {}; {} handle signals, every one read with the \
         member already out of the count",
        tally.exits, tally.stale, tally.unsignaled, tally.signals
    ));
}
