use std::collections::HashSet;

use super::{Disposition, End, Progress, RefusedRetry, Settled};

const ENDS: [End; 6] = [
    End::Completed { verified: false },
    End::Completed { verified: true },
    End::Interrupted { needs_user: false },
    End::Interrupted { needs_user: true },
    End::Uncertain {
        repeat_known: false,
    },
    End::Uncertain { repeat_known: true },
];

fn progresses() -> Vec<Progress> {
    let mut all = vec![Progress::Atomic];
    for of in [0_u32, 1, 2, 7] {
        let counts = [0, 1, of.saturating_sub(1), of, of + 1];
        let unique: HashSet<u32> = counts.into_iter().collect();
        all.extend(
            unique
                .into_iter()
                .map(|count| Progress::Counted { count, of }),
        );
    }
    all
}

fn every_settled() -> (Vec<Settled>, usize) {
    let mut settled = vec![
        Settled::Refused { needs_user: false },
        Settled::Refused { needs_user: true },
        Settled::Unknowable,
    ];
    let mut rejected = 0;
    for progress in progresses() {
        for end in ENDS {
            let impossible = match progress {
                Progress::Atomic => false,
                Progress::Counted { count, of } => {
                    count > of || (count < of && matches!(end, End::Completed { .. }))
                }
            };
            match Settled::ran(progress, end) {
                Some(shape) => {
                    assert!(!impossible, "{progress:?} {end:?} must be rejected");
                    settled.push(shape);
                }
                None => {
                    assert!(impossible, "{progress:?} {end:?} must be accepted");
                    rejected += 1;
                }
            }
        }
    }
    (settled, rejected)
}

fn nothing_posted(shape: &Settled) -> bool {
    match shape {
        Settled::Refused { .. } => true,
        Settled::Ran {
            progress: Progress::Counted { count: 0, .. },
            end: End::Interrupted { .. },
        } => true,
        Settled::Ran { .. } | Settled::Unknowable => false,
    }
}

fn needs_user(shape: &Settled) -> bool {
    matches!(
        shape,
        Settled::Refused { needs_user: true }
            | Settled::Ran {
                end: End::Interrupted { needs_user: true },
                ..
            }
    )
}

#[test]
fn disposition_table_covers_every_outcome() {
    // Given every valid way a request can settle
    let (settled, rejected) = every_settled();
    assert!(
        rejected > 0,
        "the table must exercise impossible shapes too"
    );
    // When each is mapped
    let mut reached = HashSet::new();
    for shape in &settled {
        let disposition = shape.disposition();
        // Then it is one of the seven wire pairs and nothing outside them
        assert!(
            Disposition::ALL.contains(&disposition),
            "{shape:?} -> {disposition:?}"
        );
        reached.insert(disposition);
        assert_eq!(
            matches!(disposition, Disposition::NotDelivered { .. }),
            nothing_posted(shape),
            "not_delivered iff nothing was posted: {shape:?}"
        );
        if disposition == Disposition::NOT_DELIVERED_AFTER_USER {
            assert!(needs_user(shape), "after_user needs the human: {shape:?}");
        }
        if disposition == Disposition::DELIVERED_VERIFIED {
            assert!(
                matches!(
                    shape,
                    Settled::Ran {
                        end: End::Completed { verified: true },
                        ..
                    }
                ),
                "{shape:?}"
            );
        }
        if matches!(shape, Settled::Unknowable) {
            assert_eq!(disposition, Disposition::UNKNOWN);
        }
    }
    assert_eq!(reached.len(), 7, "every pair is reachable: {reached:?}");
    assert_eq!(
        reached,
        Disposition::ALL.into_iter().collect::<HashSet<_>>()
    );
}

#[test]
fn session_options_default_to_null_reports_and_reject_a_null_report_mode() {
    use crate::report::ReportMode;
    use crate::types::{DesktopSessionOptions, InterventionPolicy, KeyPriming};
    let defaults: DesktopSessionOptions = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(defaults.report_mode, ReportMode::Null);
    assert_eq!(defaults.intervention, InterventionPolicy::Pause);
    assert_eq!(defaults.macos_key_priming, KeyPriming::Off);
    assert!(!defaults.trace);
    let object: DesktopSessionOptions =
        serde_json::from_value(serde_json::json!({"reportMode": "object"})).unwrap();
    assert_eq!(object.report_mode, ReportMode::Object);
    assert!(serde_json::from_value::<DesktopSessionOptions>(
        serde_json::json!({"reportMode": null})
    )
    .is_err());
}

#[test]
fn counted_runs_report_their_units_and_refusals_report_none() {
    let partial = Settled::ran(
        Progress::Counted { count: 3, of: 7 },
        End::Interrupted { needs_user: true },
    );
    let partial = partial.expect("a partial interrupted run is valid");
    assert_eq!(partial.disposition(), Disposition::DELIVERED_UNVERIFIED);
    assert_eq!(
        partial
            .delivered()
            .map(|delivered| (delivered.count, delivered.of)),
        Some((3, 7))
    );
    let refused = Settled::Refused { needs_user: false };
    assert_eq!(
        refused.disposition(),
        Disposition::NotDelivered {
            retry: RefusedRetry::Safe
        }
    );
    assert_eq!(refused.delivered(), None);
}
