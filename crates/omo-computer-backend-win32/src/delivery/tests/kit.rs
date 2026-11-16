//! A scripted Windows for the delivery tests: windows by HWND with their class, focus window,
//! character-wanting descendants and the child under any point, plus every post in order.

use std::collections::HashMap;
use std::time::Duration;

use omo_computer_core::params::Point;

use crate::barrier::PaintOs;
use crate::delivery::integrity::Integrity;
use crate::delivery::target::{ClientPoint, DeliveryOs, PostFailure};
use crate::input::focus_child::FocusOs;
use crate::input::Posted;

/// The client point every scripted hit-test answers.
pub(super) const CLIENT: ClientPoint = ClientPoint { x: 10, y: 20 };

#[derive(Default)]
pub(super) struct Win {
    pub(super) class: &'static str,
    pub(super) focus: Option<isize>,
    pub(super) wants_chars: Vec<isize>,
    pub(super) child_at: Option<isize>,
    /// The parent window (`None` for a top-level window).
    pub(super) parent: Option<isize>,
    /// The GUI thread, when it is another window's (two top-levels on one thread); by default each
    /// window's thread is its own id, and the thread's focus is that window's `focus`.
    pub(super) thread: Option<u32>,
}

pub(super) struct ScriptedOs {
    pub(super) windows: HashMap<isize, Win>,
    pub(super) integrity: Integrity,
    pub(super) posts: Vec<(isize, Posted)>,
    /// Posts after this many are refused with access denied.
    pub(super) deny_after: Option<usize>,
    pub(super) paintable: bool,
    /// `GetUpdateRect` reads pending this many times after the invalidate.
    pub(super) pending_reads: u32,
    pub(super) invalidated: Vec<isize>,
    pub(super) waited: Duration,
}

impl ScriptedOs {
    pub(super) fn with(windows: Vec<(isize, Win)>) -> Self {
        Self {
            windows: windows.into_iter().collect(),
            integrity: Integrity::Rids {
                target: 0x2000,
                engine: 0x2000,
            },
            posts: Vec::new(),
            deny_after: None,
            paintable: true,
            pending_reads: 1,
            invalidated: Vec::new(),
            waited: Duration::ZERO,
        }
    }

    pub(super) fn messages(&self) -> Vec<u32> {
        self.posts.iter().map(|(_, posted)| posted.msg).collect()
    }
}

pub(super) fn win(class: &'static str) -> Win {
    Win {
        class,
        ..Win::default()
    }
}

impl FocusOs for ScriptedOs {
    fn window_thread(&self, window: isize) -> Option<u32> {
        let scripted = self.windows.get(&window)?;
        Some(
            scripted
                .thread
                .unwrap_or_else(|| u32::try_from(window).unwrap_or_default()),
        )
    }

    fn thread_focus(&self, thread: u32) -> Option<isize> {
        self.windows.get(&isize::try_from(thread).ok()?)?.focus
    }
}

impl PaintOs for ScriptedOs {
    fn paintable(&self, _window: isize) -> bool {
        self.paintable
    }

    fn invalidate_pixel(&mut self, window: isize) -> bool {
        self.invalidated.push(window);
        true
    }

    fn update_pending(&self, _window: isize) -> bool {
        self.pending_reads > u32::try_from(self.waited.as_millis()).unwrap_or(u32::MAX)
    }

    fn wait(&mut self, period: Duration) -> Duration {
        self.waited += period;
        period
    }
}

impl DeliveryOs for ScriptedOs {
    fn alive(&self, window: isize) -> bool {
        self.windows.contains_key(&window)
    }

    fn class(&self, window: isize) -> Option<String> {
        self.windows.get(&window).map(|w| w.class.to_owned())
    }

    fn integrity(&self, _window: isize) -> Integrity {
        self.integrity
    }

    fn within(&self, window: isize, top: isize) -> bool {
        let mut current = Some(window);
        while let Some(at) = current {
            if at == top {
                return true;
            }
            current = self.windows.get(&at).and_then(|w| w.parent);
        }
        false
    }

    fn wants_chars(&self, window: isize) -> Vec<isize> {
        self.windows
            .get(&window)
            .map(|w| w.wants_chars.clone())
            .unwrap_or_default()
    }

    fn child_at(&self, window: isize, _at: Point) -> Option<(isize, ClientPoint)> {
        let child = self.windows.get(&window)?.child_at.unwrap_or(window);
        Some((child, CLIENT))
    }

    fn post(&mut self, window: isize, message: &Posted) -> Result<(), PostFailure> {
        if self
            .deny_after
            .is_some_and(|limit| self.posts.len() >= limit)
        {
            return Err(PostFailure::AccessDenied);
        }
        self.posts.push((window, *message));
        Ok(())
    }
}
