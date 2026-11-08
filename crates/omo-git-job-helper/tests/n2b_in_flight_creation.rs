//! N2(b) in-flight creation (design v4.2 section 20; I7, R15; RELEASE GATE for `win32-job-v1`).
//! A spawner member creates children on 4 threads (no breakaway flag); each child connects to the observer and
//! blocks. Once at least 16 have connected, H is killed. Per iteration: (1) every accepted child and the spawner
//! signal within 10 s of the name's NotFound (t_nf); (2) accepts after t_nf during a >= 2 s window are counted
//! for the receipt only (D2); (3) once the spawner signaled and the window closed, no process with the
//! iteration's unique image name is live (cntThreads > 0, E1). Refutation of I7 is (1) or (3), never (2) alone.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::{Duration, Instant};

use support::observer::Observer;
use support::op::{Launcher, Op};
use support::{example, job, process, scratch, unique, Receipt};

const MIN_ITERATIONS: usize = 200;
const CONNECTED_BEFORE_KILL: usize = 16;

fn iterations() -> usize {
    std::env::var("OMO_N2B_ITERATIONS")
        .ok()
        .and_then(|text| text.parse().ok())
        .map_or(MIN_ITERATIONS, |wanted: usize| wanted.max(MIN_ITERATIONS))
}

struct Outcome {
    line: String,
    late: usize,
    refuted: Option<String>,
}

fn iteration(
    index: usize,
    run: &str,
    child_source: &std::path::Path,
    dir: &std::path::Path,
) -> Outcome {
    let image = format!("n2b-child-{run}-{index}.exe");
    let child = dir.join(&image);
    std::fs::copy(child_source, &child).expect("copy the per-iteration child image");
    let suffix = unique("n2b");
    let observer = Observer::start(&suffix, None);
    let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
    let spawned = op
        .go(
            dir,
            &example("testkit_spawner"),
            &[&child.to_string_lossy(), &suffix, "4", "4000"],
        )
        .expect("go");
    let spawner = process::open(Op::spawned_pid(&spawned), process::WATCH).expect("spawner handle");
    assert!(
        observer.wait_for(CONNECTED_BEFORE_KILL, Duration::from_secs(60)),
        "iteration {index}: fewer than 16 children connected"
    );
    let connected_before = observer.with(<[_]>::len);
    op.kill();
    assert!(
        process::signaled_within(op.helper.raw(), Duration::from_secs(10)),
        "iteration {index}: H did not die"
    );
    let t_nf = job::wait_gone(&op.job(), Duration::from_secs(10))
        .unwrap_or_else(|| panic!("iteration {index}: name never NotFound"));
    let nf_latency = t_nf.elapsed();
    // The observation window is the measured absence of late joiners, not a wait standing in for an event.
    std::thread::sleep(Duration::from_secs(2).saturating_sub(t_nf.elapsed()));
    let (late, mut max_signal, mut unsignaled) = (
        observer.with(|all| all.iter().filter(|child| child.at > t_nf).count()),
        Duration::ZERO,
        Vec::new(),
    );
    observer.with(|all| {
        for child in all {
            let signaled = child.process.as_ref().is_none_or(|owned| {
                process::signaled_within(
                    owned.raw(),
                    Duration::from_secs(10).saturating_sub(t_nf.elapsed()),
                )
            });
            if signaled {
                max_signal = max_signal.max(t_nf.elapsed())
            } else {
                unsignaled.push(child.pid)
            }
        }
    });
    let spawner_signaled = process::signaled_within(
        spawner.raw(),
        Duration::from_secs(10).saturating_sub(t_nf.elapsed()),
    );
    let survivors = if spawner_signaled {
        process::live_by_image(&image)
    } else {
        Vec::new()
    };
    let refuted = if !unsignaled.is_empty() || !spawner_signaled {
        Some(format!("(1) iteration {index}: unsignaled children {unsignaled:?}, spawner signaled {spawner_signaled}"))
    } else if !survivors.is_empty() {
        Some(format!(
            "(3) iteration {index}: live snapshot survivors {survivors:?}"
        ))
    } else {
        None
    };
    let line = format!("iter {index}: connected-before-kill {connected_before}; accepted-after-t_nf {late}; survivors {}; NotFound {nf_latency:?}; max child signal {max_signal:?}", survivors.len());
    process::kill_image(&image);
    observer.stop();
    drop(op);
    let deadline = Instant::now() + Duration::from_secs(10);
    while std::fs::remove_file(&child).is_err() && Instant::now() < deadline {
        std::thread::yield_now();
    }
    Outcome {
        line,
        late,
        refuted,
    }
}

#[test]
fn n2b_no_process_created_in_flight_survives_the_kill_walk() {
    let mut receipt = Receipt::new("N2(b)");
    let (run, dir, source) = (unique("run"), scratch("n2b"), example("testkit_blocker"));
    let total = iterations();
    let mut refutations = Vec::new();
    let mut late_total = 0usize;
    for index in 0..total {
        let outcome = iteration(index, &run, &source, &dir);
        late_total += outcome.late;
        receipt.line(outcome.line);
        refutations.extend(outcome.refuted);
    }
    receipt.line(format!(
        "summary: {total} iterations; late accepts (receipt-only) {late_total}; refutations {}",
        refutations.len()
    ));
    assert!(
        refutations.is_empty(),
        "I7 refuted (release gate):\n{}\n{receipt}",
        refutations.join("\n")
    );
}
