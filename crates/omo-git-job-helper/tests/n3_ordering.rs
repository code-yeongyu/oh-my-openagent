//! N3 ordering pin (design v4.2 section 20; I5, I6; R1, R2): a prober waits on H's handle and probes F at once.
#![cfg(windows)]

mod support;

use std::process::Stdio;
use std::time::{Duration, Instant};

use support::job::{self, State};
use support::observer::Observer;
use support::op::{Launcher, Op};
use support::{example, process, scratch, unique, Receipt};
use windows_sys::Win32::Foundation::HANDLE;

const ITERATIONS: usize = 200;

struct Probe {
    first: State,
    present_with_members_at_bound: bool,
    not_found: Option<Instant>,
    latency: Duration,
}

fn probe_after_death(helper: usize, name: &str) -> Probe {
    let helper = helper as HANDLE;
    assert!(
        process::signaled_within(helper, Duration::from_secs(10)),
        "H never signaled"
    );
    let signaled = Instant::now();
    let first = job::state(name);
    let mut last = first;
    while last != State::Gone && signaled.elapsed() < Duration::from_secs(10) {
        if signaled.elapsed() >= Duration::from_secs(2)
            && matches!(last, State::Present { active } if active > 0)
        {
            return Probe {
                first,
                present_with_members_at_bound: true,
                not_found: None,
                latency: signaled.elapsed(),
            };
        }
        std::thread::yield_now();
        last = job::state(name);
    }
    let not_found = (last == State::Gone).then(Instant::now);
    Probe {
        first,
        present_with_members_at_bound: false,
        not_found,
        latency: signaled.elapsed(),
    }
}

#[test]
fn n3_a_signaled_helper_has_closed_f_and_a_gone_name_means_dead_members() {
    let mut receipt = Receipt::new("N3");
    let (mut immediate_gone, mut max_latency) = (0usize, Duration::ZERO);
    for iteration in 0..ITERATIONS {
        let suffix = unique("n3");
        let observer = Observer::start(&suffix, None);
        let mut op = Op::start(&[], Launcher::Direct, Stdio::null()).expect("helper run");
        op.go(&scratch("n3"), &example("testkit_blocker"), &[&suffix])
            .expect("go");
        assert!(
            observer.wait_for(1, Duration::from_secs(30)),
            "iteration {iteration}: member never connected"
        );
        let member = observer
            .with(|accepted| accepted[0].process.as_ref().map(|owned| owned.raw()))
            .expect("member handle");
        let (helper, name) = (op.helper.raw() as usize, op.job());
        let prober = std::thread::spawn(move || probe_after_death(helper, &name));
        op.kill();
        let probe = prober.join().expect("prober");
        let member_signaled = probe.not_found.is_some_and(|at| {
            process::signaled_within(member, Duration::from_secs(10).saturating_sub(at.elapsed()))
        });
        immediate_gone += usize::from(probe.first == State::Gone);
        max_latency = max_latency.max(probe.latency);
        receipt.line(format!(
            "iter {iteration}: first {:?}; NotFound after {:?}; members-present-at-2s {}; member signaled {member_signaled}",
            probe.first, probe.latency, probe.present_with_members_at_bound
        ));
        assert!(
            !probe.present_with_members_at_bound,
            "I6: H signaled and F still had members at 2 s\n{receipt}"
        );
        assert!(
            probe.not_found.is_some(),
            "I5: the name never went away within 10 s\n{receipt}"
        );
        assert!(member_signaled, "I5: a member outlived the name\n{receipt}");
    }
    receipt.line(format!("summary: {ITERATIONS} iterations; first probe already NotFound {immediate_gone}; max NotFound latency {max_latency:?}"));
}
