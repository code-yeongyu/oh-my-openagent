//! Readers of the option objects and predicates params reference.

use super::Reader;

pub const READERS: &[Reader] = &[
    (
        "CaptureCaps",
        "capture policy: frame scaling",
        &["maxWidth", "maxHeight", "maxBytes"],
    ),
    ("Point", "coordinate frame: point mapping", &["x", "y"]),
    (
        "Rect",
        "coordinate frame: rect mapping",
        &["x", "y", "width", "height"],
    ),
    (
        "SettleOptions",
        "settle: quiet window",
        &["quietMs", "timeoutMs"],
    ),
    ("ObserveAx", "observe: AX budget", &["maxNodes"]),
    (
        "WaitPredicate",
        "waitFor: predicate wait",
        &[
            "settle",
            "text",
            "ref",
            "state",
            "window",
            "surface",
            "notification",
            "event",
            "session",
        ],
    ),
    (
        "ObserveOptions",
        "observe: observation request",
        &[
            "screenshot",
            "ax",
            "query",
            "since",
            "depth",
            "skeleton",
            "actions",
            "settle",
            "ocr",
        ],
    ),
    (
        "TextRange",
        "ax.selectText: range resolution",
        &["start", "end", "text"],
    ),
    (
        "SurfacePredicate",
        "waitFor: surface observer",
        &["kind", "state"],
    ),
    (
        "NotificationPredicate",
        "waitFor: notification observer",
        &["app", "title"],
    ),
    (
        "SessionPredicate",
        "waitFor: session sampler",
        &[
            "screenLocked",
            "displayAsleep",
            "sessionActive",
            "secureInputActive",
            "userActive",
        ],
    ),
    ("EventPredicate", "waitFor: AX event observer", &["kind"]),
    (
        "WindowPredicate",
        "waitFor: window observer",
        &["state", "title", "app"],
    ),
];
