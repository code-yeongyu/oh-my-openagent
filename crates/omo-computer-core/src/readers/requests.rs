//! Readers of the read requests, the v1 requests and the host-only requests.

use super::Reader;

pub const READERS: &[Reader] = &[
    (
        "SessionOpenParams",
        "session.open: session options",
        &[
            "reportMode",
            "intervention",
            "macosKeyPriming",
            "trace",
            "showCursor",
            "allowHostRelayOnlyStop",
            "settings",
        ],
    ),
    (
        "WindowsParams",
        "windows: window filter",
        &["app", "title", "pid"],
    ),
    (
        "CaptureParams",
        "capture: capture request",
        &[
            "target",
            "caps",
            "excludeWindowTitles",
            "crosshair",
            "cursor",
        ],
    ),
    ("ZoomParams", "zoom: frame crop", &["target", "region"]),
    (
        "ObserveParams",
        "observe: observation request",
        &[
            "target",
            "caps",
            "ax",
            "screenshot",
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
        "AxTargetParams",
        "ax.snapshot: target resolution",
        &["target"],
    ),
    ("DrillParams", "ax.drill: cut expansion", &["ref", "depth"]),
    ("AxRefParams", "ref registry: ref resolution", &["ref"]),
    (
        "ElementAtParams",
        "elementAt: hit-test",
        &["target", "x", "y", "frameId"],
    ),
    (
        "WaitForParams",
        "waitFor: predicate wait",
        &["target", "predicate", "timeout"],
    ),
    (
        "MenuItemsParams",
        "menu.items: menu walk",
        &["target", "path"],
    ),
    (
        "SurfaceParams",
        "surface: surface lookup",
        &["kind", "index"],
    ),
    ("TypeTextParams", "typeText: v1 typing", &["target", "text"]),
    ("KeyChordParams", "keyChord: v1 chord", &["target", "keys"]),
    (
        "HoldKeysParams",
        "holdKeys: held-input ledger",
        &["target", "keys", "duration"],
    ),
    (
        "HoldMouseParams",
        "holdMouse: held-input ledger",
        &["target", "x", "y", "duration"],
    ),
    ("RaiseWindowParams", "raiseWindow: v1 raise", &["windowId"]),
    (
        "AxPerformParams",
        "ax.perform: semantic action",
        &["ref", "action"],
    ),
    (
        "AxTypeTextParams",
        "ax.typeText: AX typing",
        &["ref", "text"],
    ),
    (
        "OpenSystemSurfaceParams",
        "openSystemSurface: surface opener",
        &["kind"],
    ),
    (
        "ControlGrantParams",
        "control.grant: foreground grant",
        &["reason", "confirmationId"],
    ),
    (
        "StopPathStartParams",
        "stopPath.start: stop listener",
        &["chord"],
    ),
    (
        "StopPathStopParams",
        "stopPath.stop: stop latch",
        &["source"],
    ),
    (
        "StopPathResumeParams",
        "stopPath.resume: resume token check",
        &["token"],
    ),
    ("CancelParams", "$/cancel: in-flight call table", &["id"]),
    (
        "AdvanceClockParams",
        "$/test.advanceClock: fake clock",
        &["ms"],
    ),
];
