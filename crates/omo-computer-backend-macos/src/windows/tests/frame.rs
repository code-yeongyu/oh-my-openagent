//! Frame verbs with read-back (M11), immovable windows, the restore lease and the window query.

use std::collections::BTreeMap;

use omo_computer_core::backend::Refusal;
use omo_computer_core::error::{EngineCode, Reason};
use omo_computer_core::listing::Rect;
use omo_computer_core::window_frame::{judge, FrameOutcome};

use crate::windows::seam::{FoundWindow, QueryNode, WindowOs};
use crate::windows::MacWindows;

#[derive(Default)]
struct FakeWindows {
    frames: BTreeMap<u32, Rect>,
    full_screen: Vec<u32>,
    pinned_width: Option<f64>,
    minimized: BTreeMap<u32, bool>,
    writes: Vec<String>,
    app_windows: Vec<QueryNode>,
    children: BTreeMap<u64, Vec<QueryNode>>,
    listed: Vec<FoundWindow>,
}

impl WindowOs for FakeWindows {
    fn frame(&mut self, window: u32) -> Option<Rect> {
        self.frames.get(&window).copied()
    }

    fn position_settable(&mut self, window: u32) -> Option<bool> {
        self.frames.contains_key(&window).then_some(true)
    }

    fn full_screen(&mut self, window: u32) -> Option<bool> {
        Some(self.full_screen.contains(&window))
    }

    fn set_position(&mut self, window: u32, x: f64, y: f64) -> bool {
        self.writes.push(format!("position {window}"));
        self.frames
            .get_mut(&window)
            .map(|f| (f.x, f.y) = (x, y))
            .is_some()
    }

    fn set_size(&mut self, window: u32, width: f64, height: f64) -> bool {
        self.writes.push(format!("size {window}"));
        let width = self.pinned_width.unwrap_or(width);
        self.frames
            .get_mut(&window)
            .map(|f| (f.width, f.height) = (width, height))
            .is_some()
    }

    fn minimized(&mut self, window: u32) -> Option<bool> {
        self.minimized.get(&window).copied()
    }

    fn set_minimized(&mut self, window: u32, minimized: bool) -> bool {
        self.writes.push(format!("minimized {window} {minimized}"));
        self.minimized.insert(window, minimized);
        true
    }

    fn app_windows(&mut self, _pid: u32) -> Vec<QueryNode> {
        self.app_windows.clone()
    }

    fn children(&mut self, node: u64) -> Vec<QueryNode> {
        self.children.get(&node).cloned().unwrap_or_default()
    }

    fn listed_windows(&mut self, _pid: u32) -> Vec<FoundWindow> {
        self.listed.clone()
    }
}

const AT: Rect = Rect {
    x: 100.0,
    y: 100.0,
    width: 800.0,
    height: 600.0,
};

fn windows() -> MacWindows<FakeWindows> {
    let mut fake = FakeWindows::default();
    fake.frames.insert(7, AT);
    fake.minimized.insert(7, false);
    MacWindows::new(fake)
}

#[test]
fn set_frame_reads_back_within_1px() {
    let mut windows = windows();
    let asked = Rect {
        x: 20.0,
        y: 40.0,
        width: 640.0,
        height: 480.0,
    };
    let applied = windows.set_frame("7", asked).expect("applied");
    assert!(!applied.immovable);
    assert_eq!(judge(asked, applied.frame), FrameOutcome::Confirmed);

    windows.os_mut().pinned_width = Some(700.0);
    let applied = windows.set_frame("7", AT).expect("applied");
    assert!(
        matches!(judge(AT, applied.frame), FrameOutcome::Partial { .. }),
        "the read-back, never the request"
    );
}

#[test]
fn immovable_window_is_window_immovable() {
    let mut windows = windows();
    windows.os_mut().full_screen.push(7);
    assert_eq!(windows.frame_settable("7"), Some(false));
    let applied = windows
        .set_frame("7", Rect { x: 0.0, ..AT })
        .expect("answered");
    assert!(applied.immovable);
    assert_eq!(applied.frame, AT, "frame unchanged");
    assert!(
        windows.os().writes.is_empty(),
        "nothing written to an immovable window"
    );
}

#[test]
fn set_frame_and_minimize_work_without_a_lease_restore_requires_it() {
    let mut windows = windows();
    windows
        .set_frame("7", Rect { x: 0.0, ..AT })
        .expect("setFrame needs no lease");
    assert_eq!(
        windows.set_minimized("7", true),
        Ok(()),
        "minimize needs no lease"
    );
    let writes = windows.os().writes.len();
    assert_eq!(
        windows.set_minimized("7", false),
        Err(Refusal::new(
            EngineCode::ControlRequired,
            Reason::LeaseMissing
        ))
    );
    assert_eq!(
        windows.os().writes.len(),
        writes,
        "nothing sent without the lease"
    );
    windows.set_lease(true);
    assert_eq!(windows.set_minimized("7", false), Ok(()));
    assert_eq!(windows.os().minimized.get(&7), Some(&false));
}

#[test]
fn unknown_window_is_window_not_found() {
    let mut windows = windows();
    for id in ["8", "x"] {
        assert_eq!(
            windows.set_frame(id, AT),
            Err(Refusal::bare(EngineCode::WindowNotFound))
        );
    }
}

fn found(number: Option<u32>, role: &str, subrole: Option<&str>) -> FoundWindow {
    FoundWindow {
        number,
        role: role.into(),
        subrole: subrole.map(Into::into),
        title: None,
        frame: None,
    }
}

fn at(id: u64, found: FoundWindow) -> QueryNode {
    QueryNode { id, found }
}

#[test]
fn windows_the_list_omits_are_found_through_the_window_query() {
    let mut windows = windows();
    let window = found(Some(7), "AXWindow", Some("AXStandardWindow"));
    let sheet = found(None, "AXSheet", None);
    let popover = found(None, "AXPopover", None);
    let button = found(None, "AXButton", None);
    let elsewhere = found(Some(9), "AXWindow", None);
    let fake = windows.os_mut();
    fake.app_windows = vec![at(1, window.clone())];
    fake.children.insert(
        1,
        vec![at(2, sheet.clone()), at(3, found(None, "AXGroup", None))],
    );
    fake.children
        .insert(3, vec![at(4, button), at(5, popover.clone())]);
    // The window list names window 7 (this Space) and window 9 (another Space).
    fake.listed = vec![found(Some(7), "AXWindow", None), elsewhere.clone()];
    assert_eq!(
        windows.query(70),
        vec![window, sheet, popover, elsewhere],
        "sheets and popovers from the AX children, other Spaces from the window list, no duplicate"
    );
}
