//! Done latency (omo#10391, design v4.2 sections 7.2, 9 and 17; T15 measured about 265 ms added per command): after
//! the operation's last member has exited, H reports `done` well inside its 250 ms lost-notification recheck. Each
//! iteration prints a timeline of member exits (process handles), F's `ActiveProcesses` (probed by name, in-frame)
//! and H's frames.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use support::job::{self, State};
use support::observer::Observer;
use support::op::{Launcher, Op};
use support::timeline::{median, member_label, ms, Timeline};
use support::{example, process, scratch, unique, Receipt};

const ITERATIONS: usize = 20;
/// Far below the helper's 250 ms recheck and far above scheduling noise on a hosted runner.
const DONE_BOUND: Duration = Duration::from_millis(50);
/// An iteration this slow waited out the helper's 250 ms recheck: a member exit that woke nothing.
const RECHECK_WAIT: Duration = Duration::from_millis(200);
const BOUND: Duration = Duration::from_secs(30);

struct Iteration {
    gap: Option<Duration>,
    line: String,
}

fn probe_f_until_gone(
    timeline: &Arc<Timeline>,
    stop: &Arc<AtomicBool>,
    name: String,
) -> std::thread::JoinHandle<()> {
    let (timeline, stop) = (Arc::clone(timeline), Arc::clone(stop));
    std::thread::spawn(move || {
        let mut last = None;
        while !stop.load(Ordering::SeqCst) {
            let state = job::state(&name);
            if last != Some(state) {
                timeline.mark(format!("F {state:?}"));
                last = Some(state);
            }
            if state == State::Gone {
                return;
            }
            std::thread::yield_now();
        }
    })
}

fn frames_until_done(op: &mut Op, timeline: &Timeline) -> Option<Duration> {
    loop {
        match op.frame(BOUND) {
            Ok(frame) => {
                let at = timeline.mark(format!("frame {frame:?}"));
                if frame == "done" {
                    return Some(at);
                }
            }
            Err(error) => {
                timeline.mark(format!("frame error {error}"));
                return None;
            }
        }
    }
}

fn iteration(index: usize) -> Iteration {
    let suffix = unique("done-latency");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let spawned = op
        .go(
            &scratch("done-latency"),
            &example("testkit_blocker"),
            &[&suffix],
        )
        .expect("go");
    assert!(
        observer.wait_for(1, BOUND),
        "iteration {index}: root never connected ({spawned})"
    );
    let name = op.job();
    let members = job::pid_list(job::open_query(&name).expect("open F for query").raw());
    let timeline = Timeline::new();
    let (mut waiters, mut labels) = (Vec::new(), Vec::new());
    for pid in members.into_iter().filter(|&pid| pid != op.helper_pid) {
        let Some(handle) = process::open(pid, process::WATCH) else {
            labels.push(format!("{pid}:unopenable"));
            continue;
        };
        let label = member_label(handle.raw(), pid);
        labels.push(label.clone());
        waiters.push(timeline.watch_exit(handle, label, BOUND));
    }
    let stop = Arc::new(AtomicBool::new(false));
    let prober = probe_f_until_gone(&timeline, &stop, name);
    let release = timeline.mark("release");
    observer.stop();
    let done = frames_until_done(&mut op, &timeline);
    let exits: Option<Vec<Duration>> = waiters
        .into_iter()
        .map(|waiter| waiter.join().expect("waiter"))
        .collect();
    let code = op.exited_within(Duration::from_secs(10));
    stop.store(true, Ordering::SeqCst);
    prober.join().expect("prober");
    let last_exit = exits.and_then(|all| all.into_iter().max());
    let gap = done
        .zip(last_exit)
        .map(|(done, last)| done.saturating_sub(last));
    Iteration {
        gap,
        line: format!(
            "iter {index}: members {labels:?}; H exit {code:?}; done after last member exit {:?} ms; timeline: {}",
            gap.map(ms),
            timeline.render(release)
        ),
    }
}

#[test]
fn done_follows_the_last_member_exit_without_waiting_out_the_recheck() {
    let mut receipt = Receipt::new("done latency");
    let mut gaps = Vec::new();
    for index in 0..ITERATIONS {
        let result = iteration(index);
        receipt.line(result.line);
        let gap = result.gap.unwrap_or_else(|| {
            panic!("iteration {index}: no done frame or a member never exited\n{receipt}")
        });
        gaps.push(gap);
    }
    let max = gaps.iter().copied().max().unwrap_or_default();
    let waited = gaps.iter().filter(|&&gap| gap >= RECHECK_WAIT).count();
    let median = median(&mut gaps);
    receipt.line(format!(
        "summary: {ITERATIONS} iterations; done after last member exit median {:.3}ms max {:.3}ms (bound {:.0}ms); \
         iterations that waited out the recheck {waited}",
        ms(median),
        ms(max),
        ms(DONE_BOUND)
    ));
    assert!(median < DONE_BOUND, "{receipt}");
    assert_eq!(waited, 0, "{receipt}");
}
