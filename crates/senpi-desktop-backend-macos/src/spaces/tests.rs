use std::cell::{Cell, RefCell};
use std::time::{Duration, Instant};

use senpi_desktop_core::error::{CoreResult, DesktopError, ErrorCode};

use super::guard::sends_back;
use super::mover::{bring, on_another_space, verified_move, FrontContext, SpaceId, SpaceServer, MOVE_DEADLINE, MOVE_POLL};

const WINDOW: &str = "77";
const OWNER: libc::pid_t = 4242;
const HERE: SpaceId = SpaceId(9);
const ELSEWHERE: SpaceId = SpaceId(4);
const FOCUS: FrontContext = FrontContext { pid: 100, window: 5 };

/// A scripted WindowServer on a virtual clock: `wait` advances time, so the
/// 1.2 s deadline is reached without sleeping.
struct FakeServer {
    owner: Cell<libc::pid_t>,
    active: Cell<SpaceId>,
    space_type: i32,
    memberships: RefCell<Vec<SpaceId>>,
    /// Membership reads after the move before it shows; `None` never shows.
    settles_after: Cell<Option<usize>>,
    displays: RefCell<Vec<(String, SpaceId)>>,
    front: Cell<Option<FrontContext>>,
    /// Applied right after the move request (the user acting meanwhile).
    on_move: Box<dyn Fn(&Self)>,
    /// Applied as the guard starts, before the action re-checks the state.
    on_guard: Box<dyn Fn(&Self)>,
    moves: RefCell<Vec<(u32, SpaceId)>>,
    guarded: RefCell<Vec<libc::pid_t>>,
    start: Instant,
    elapsed: Cell<Duration>,
}

impl FakeServer {
    fn on_another_space() -> Self {
        Self {
            owner: Cell::new(OWNER),
            active: Cell::new(HERE),
            space_type: 0,
            memberships: RefCell::new(vec![ELSEWHERE]),
            settles_after: Cell::new(Some(1)),
            displays: RefCell::new(vec![("main".to_owned(), HERE)]),
            front: Cell::new(Some(FOCUS)),
            on_move: Box::new(|_| {}),
            on_guard: Box::new(|_| {}),
            moves: RefCell::new(Vec::new()),
            guarded: RefCell::new(Vec::new()),
            start: Instant::now(),
            elapsed: Cell::new(Duration::ZERO),
        }
    }
}

impl SpaceServer for FakeServer {
    fn owner_pid(&self, _wid: u32) -> CoreResult<libc::pid_t> {
        Ok(self.owner.get())
    }
    fn active_space(&self) -> CoreResult<SpaceId> {
        Ok(self.active.get())
    }
    fn space_type(&self, _space: SpaceId) -> i32 {
        self.space_type
    }
    fn memberships(&self, _wid: u32) -> CoreResult<Vec<SpaceId>> {
        if !self.moves.borrow().is_empty() {
            match self.settles_after.get() {
                Some(0) => *self.memberships.borrow_mut() = vec![HERE],
                Some(reads) => self.settles_after.set(Some(reads - 1)),
                None => {}
            }
        }
        Ok(self.memberships.borrow().clone())
    }
    fn display_spaces(&self) -> CoreResult<Vec<(String, SpaceId)>> {
        Ok(self.displays.borrow().clone())
    }
    fn move_window(&self, wid: u32, space: SpaceId) {
        self.moves.borrow_mut().push((wid, space));
        (self.on_move)(self);
    }
    fn front_context(&self) -> Option<FrontContext> {
        self.front.get()
    }
    fn with_background_guard(&self, pid: libc::pid_t, action: &mut dyn FnMut() -> CoreResult<()>) -> CoreResult<()> {
        self.guarded.borrow_mut().push(pid);
        (self.on_guard)(self);
        action()
    }
    fn now(&self) -> Instant {
        self.start + self.elapsed.get()
    }
    fn wait(&self, duration: Duration) {
        self.elapsed.set(self.elapsed.get() + duration);
    }
}

fn never_stopped() -> CoreResult<()> {
    Ok(())
}

fn code(result: CoreResult<()>) -> Option<ErrorCode> {
    result.err().map(|error| error.code)
}

#[test]
fn a_fullscreen_current_space_is_refused_before_any_move() {
    // Given: the user's current Space is a fullscreen app's (type 4)
    let server = FakeServer { space_type: 4, ..FakeServer::on_another_space() };
    // When
    let result = bring(&server, WINDOW, &never_stopped);
    // Then: SpaceMoveDenied, and nothing was requested or guarded
    assert_eq!(code(result), Some(ErrorCode::SpaceMoveDenied));
    assert!(server.moves.borrow().is_empty());
    assert!(server.guarded.borrow().is_empty());
}

#[test]
fn a_window_already_on_the_current_space_is_left_alone() {
    // Given: the window is a member of the current Space (and another one)
    let server = FakeServer::on_another_space();
    *server.memberships.borrow_mut() = vec![ELSEWHERE, HERE];
    // When
    let result = bring(&server, WINDOW, &never_stopped);
    // Then: success without a move
    assert_eq!(result, Ok(()));
    assert!(server.moves.borrow().is_empty());
    assert!(server.guarded.borrow().is_empty());
}

#[test]
fn a_window_on_another_space_is_moved_inside_the_owners_background_guard() {
    // Given: WindowServer shows the move on the second read
    let server = FakeServer::on_another_space();
    server.settles_after.set(Some(1));
    // When
    let result = bring(&server, WINDOW, &never_stopped);
    // Then: one move to the current Space, guarded for the owning process
    assert_eq!(result, Ok(()));
    assert_eq!(*server.moves.borrow(), [(77, HERE)]);
    assert_eq!(*server.guarded.borrow(), [OWNER]);
    assert_eq!(server.elapsed.get(), MOVE_POLL);
}

#[test]
fn a_move_windowserver_never_shows_fails_at_the_deadline() {
    // Given: the move request is ignored
    let server = FakeServer::on_another_space();
    server.settles_after.set(None);
    // When
    let result = bring(&server, WINDOW, &never_stopped);
    // Then: SpaceMoveDenied once the 1.2 s budget is spent, polling every 25 ms
    let error = result.expect_err("unverified move");
    assert_eq!(error.code, ErrorCode::SpaceMoveDenied);
    assert!(error.message.contains("did not move window 77"), "{}", error.message);
    assert_eq!(server.elapsed.get(), MOVE_DEADLINE);
}

#[test]
fn the_user_switching_spaces_during_the_move_is_reported_not_undone() {
    // Given: the user changes Space right after the move request
    let server = FakeServer {
        on_move: Box::new(|server: &FakeServer| server.active.set(SpaceId(12))),
        ..FakeServer::on_another_space()
    };
    // When
    let result = bring(&server, WINDOW, &never_stopped);
    // Then: SpaceMoveDenied naming the change; no second move put things back
    let error = result.expect_err("Space changed");
    assert_eq!(error.code, ErrorCode::SpaceMoveDenied);
    assert!(error.message.contains("Space or focus changed"), "{}", error.message);
    assert_eq!(server.moves.borrow().len(), 1);
}

#[test]
fn the_user_changing_focus_during_the_move_is_reported() {
    // Given: another window becomes key while the move settles
    let server = FakeServer {
        on_move: Box::new(|server: &FakeServer| server.front.set(Some(FrontContext { pid: 100, window: 6 }))),
        ..FakeServer::on_another_space()
    };
    // When / Then
    assert_eq!(code(bring(&server, WINDOW, &never_stopped)), Some(ErrorCode::SpaceMoveDenied));
}

#[test]
fn a_space_change_before_dispatch_requests_no_move() {
    // Given: the user switches Space between the snapshot and the dispatch
    let server = FakeServer {
        on_guard: Box::new(|server: &FakeServer| server.active.set(SpaceId(12))),
        ..FakeServer::on_another_space()
    };
    // When
    let result = bring(&server, WINDOW, &never_stopped);
    // Then: refused inside the guard with nothing requested
    let error = result.expect_err("Space changed before dispatch");
    assert_eq!(error.code, ErrorCode::SpaceMoveDenied);
    assert!(error.message.contains("no move was requested"), "{}", error.message);
    assert!(server.moves.borrow().is_empty());
}

#[test]
fn a_stop_before_dispatch_moves_nothing() {
    // Given
    let server = FakeServer::on_another_space();
    let stopped = || Err(DesktopError::new(ErrorCode::Suspended, "stop chord"));
    // When / Then
    assert_eq!(code(bring(&server, WINDOW, &stopped)), Some(ErrorCode::Suspended));
    assert!(server.moves.borrow().is_empty());
}

#[test]
fn an_owner_change_while_settling_is_window_not_found() {
    // Given: the window id is reused by another process after the move
    let server = FakeServer {
        on_move: Box::new(|server: &FakeServer| server.owner.set(OWNER + 1)),
        ..FakeServer::on_another_space()
    };
    // When / Then
    assert_eq!(code(bring(&server, WINDOW, &never_stopped)), Some(ErrorCode::WindowNotFound));
}

#[test]
fn a_non_numeric_or_zero_window_id_is_an_invalid_target() {
    let server = FakeServer::on_another_space();
    assert_eq!(code(bring(&server, "abc", &never_stopped)), Some(ErrorCode::InvalidTarget));
    assert_eq!(code(bring(&server, "0", &never_stopped)), Some(ErrorCode::InvalidTarget));
}

#[test]
fn unknown_focus_refuses_before_any_move() {
    let server = FakeServer::on_another_space();
    server.front.set(None);
    assert_eq!(code(bring(&server, WINDOW, &never_stopped)), Some(ErrorCode::SpaceMoveDenied));
    assert!(server.moves.borrow().is_empty());
}

#[test]
fn ignored_or_partial_native_move_is_not_success() {
    assert!(!verified_move(HERE, &[SpaceId(3)]));
    assert!(!verified_move(HERE, &[SpaceId(3), HERE]));
    assert!(!verified_move(HERE, &[]));
    assert!(!verified_move(SpaceId(0), &[SpaceId(0)]));
    assert!(verified_move(HERE, &[HERE]));
}

#[test]
fn an_unknown_space_membership_is_not_proof_of_no_window_elsewhere() {
    // Space 9 is current. A window on Space 4 is elsewhere; one kept ordered
    // out belongs to no Space.
    assert_eq!(on_another_space(&[HERE], [Some(vec![HERE]), Some(vec![ELSEWHERE])]), Some(true));
    assert_eq!(on_another_space(&[HERE], [Some(vec![HERE]), Some(vec![])]), Some(false));
    assert_eq!(on_another_space(&[HERE], []), Some(false));
    assert_eq!(on_another_space(&[HERE], [Some(vec![HERE]), None]), None);
}

#[test]
fn a_window_on_any_displays_shown_space_is_not_elsewhere() {
    // Separate Spaces per display: main shows 9, the second 4.
    assert_eq!(on_another_space(&[HERE, ELSEWHERE], [Some(vec![ELSEWHERE])]), Some(false));
    assert_eq!(on_another_space(&[HERE, ELSEWHERE], [Some(vec![SpaceId(3), HERE])]), Some(false));
    assert_eq!(on_another_space(&[HERE, ELSEWHERE], [Some(vec![SpaceId(3)])]), Some(true));
}

#[test]
fn the_guard_sends_back_only_a_target_that_came_forward() {
    // The target came forward over the user's app: send it back.
    assert!(sends_back(Some(100), OWNER, Some(OWNER)));
    // The target was already the user's front app: nothing to undo.
    assert!(!sends_back(Some(OWNER), OWNER, Some(OWNER)));
    // The user's app (or another the user picked) is front: leave it.
    assert!(!sends_back(Some(100), OWNER, Some(100)));
    assert!(!sends_back(Some(100), OWNER, Some(300)));
    // No front window was captured: nothing to put back.
    assert!(!sends_back(None, OWNER, Some(OWNER)));
}
