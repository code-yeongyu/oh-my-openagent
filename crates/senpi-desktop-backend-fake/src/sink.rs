use std::sync::{mpsc, Arc};

use parking_lot::Mutex;
use senpi_desktop_core::backend::{DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{DesktopPoint, FrontWindow, Target};

/// A pointer event as the fake received it (global logical coordinates).
#[derive(Debug, Clone, PartialEq)]
pub enum RecordedPointer {
    Click {
        at: DesktopPoint,
        button: MouseButton,
        count: u32,
        modifiers: Modifiers,
    },
    Move {
        at: DesktopPoint,
    },
    Drag {
        path: Vec<DesktopPoint>,
        button: MouseButton,
        modifiers: Modifiers,
    },
    Scroll {
        at: DesktopPoint,
        dx: f64,
        dy: f64,
    },
}

impl RecordedPointer {
    /// Where the cursor ends up after this event.
    pub fn end_point(&self) -> Option<DesktopPoint> {
        match self {
            Self::Click { at, .. } | Self::Move { at } | Self::Scroll { at, .. } => Some(*at),
            Self::Drag { path, .. } => path.last().copied(),
        }
    }
}

impl From<PointerEvent> for RecordedPointer {
    fn from(event: PointerEvent) -> Self {
        match event {
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => Self::Click {
                at: DesktopPoint { x, y },
                button,
                count,
                modifiers,
            },
            PointerEvent::Move { x, y } => Self::Move {
                at: DesktopPoint { x, y },
            },
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => Self::Drag {
                path: path.into_iter().map(|(x, y)| DesktopPoint { x, y }).collect(),
                button,
                modifiers,
            },
            PointerEvent::Scroll { x, y, dx, dy } => Self::Scroll {
                at: DesktopPoint { x, y },
                dx,
                dy,
            },
        }
    }
}

/// One side effect the fake backend performed, in call order.
#[derive(Debug, Clone, PartialEq)]
pub enum SinkOp {
    HeldKey {
        target: Target,
        key: KeyName,
        down: bool,
        mode: DeliveryMode,
    },
    HeldButton {
        target: Target,
        at: DesktopPoint,
        button: MouseButton,
        down: bool,
        mode: DeliveryMode,
    },
    Pointer {
        target: Target,
        event: RecordedPointer,
        mode: DeliveryMode,
    },
    TypeText {
        target: Target,
        text: String,
        mode: DeliveryMode,
    },
    ClipboardWrite {
        text: String,
    },
    KeyChord {
        target: Target,
        keys: Vec<KeyName>,
        mode: DeliveryMode,
    },
    RaiseWindow {
        id: String,
    },
    ReleaseAll,
    WarpCursor(DesktopPoint),
    QueryFrontWindow,
    RestoreFrontWindow(FrontWindow),
    RestoreKeyFocus(FrontWindow),
    AxPerform {
        node: u64,
        action: String,
    },
    AxSetValue {
        node: u64,
        value: String,
    },
    AxFocus {
        node: u64,
    },
    MenuSelect {
        window: String,
        path: Vec<String>,
        delivery: DeliveryMode,
    },
}

/// Shared, cloneable log of every [`SinkOp`]; clones observe the same log, so
/// a test keeps one while the backend moves into a session thread.
#[derive(Debug, Clone, Default)]
pub struct RecordingSink {
    ops: Arc<Mutex<Vec<SinkOp>>>,
    subscribers: Arc<Mutex<Vec<mpsc::Sender<SinkOp>>>>,
    held: Arc<Mutex<Vec<SinkOp>>>,
}

impl RecordingSink {
    pub(crate) fn record(&self, op: SinkOp) {
        {
            let mut held = self.held.lock();
            match &op {
                SinkOp::HeldKey { down: true, .. } | SinkOp::HeldButton { down: true, .. } => held.push(op.clone()),
                SinkOp::HeldKey { target, key, down: false, mode } => held.retain(|held| {
                    !matches!(held, SinkOp::HeldKey { target: t, key: k, mode: m, .. } if t == target && k == key && m == mode)
                }),
                SinkOp::HeldButton { target, button, down: false, mode, .. } => held.retain(|held| {
                    !matches!(held, SinkOp::HeldButton { target: t, button: b, mode: m, .. } if t == target && b == button && m == mode)
                }),
                _ => {}
            }
        }
        self.ops.lock().push(op.clone());
        self.subscribers.lock().retain(|subscriber| subscriber.send(op.clone()).is_ok());
    }

    /// Subscribe before submitting a request; tests await actual emitted
    /// input rather than guessing when the session thread started its hold.
    pub fn subscribe(&self) -> mpsc::Receiver<SinkOp> {
        let (sender, receiver) = mpsc::channel();
        self.subscribers.lock().push(sender);
        receiver
    }

    /// Snapshot of every recorded op, oldest first.
    pub fn ops(&self) -> Vec<SinkOp> {
        self.ops.lock().clone()
    }

    pub(crate) fn release_held(&self) {
        let held = self.held.lock().clone();
        // Preparation has emitted no HeldKey/HeldButton down, so it adds no
        // entries and is skipped without touching or waiting for that scope.
        for mut op in held {
            match &mut op {
                SinkOp::HeldKey { down, .. } | SinkOp::HeldButton { down, .. } => *down = false,
                _ => unreachable!("held contains only input downs"),
            }
            self.record(op);
        }
    }
}

impl senpi_desktop_core::backend::EmergencyRelease for RecordingSink {
    fn release_all(&self) -> senpi_desktop_core::error::CoreResult<()> {
        self.release_held();
        Ok(())
    }
}
