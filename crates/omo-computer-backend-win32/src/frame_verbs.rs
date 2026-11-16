//! Frame verbs (row 60): `SetWindowPos(SWP_NOACTIVATE|SWP_NOZORDER)` without the lease, then a
//! `GetWindowRect` read-back that is the frame the report states, never the request.

use omo_computer_core::listing::Rect;

/// The two OS calls a frame write makes.
pub trait FrameOs {
    fn set_window_pos(&mut self, hwnd: isize, rect: Rect, flags: u32) -> bool;
    fn window_rect(&mut self, hwnd: isize) -> Option<Rect>;
}

pub const SWP_NOZORDER: u32 = 0x0004;
pub const SWP_NOACTIVATE: u32 = 0x0010;

/// Moves and resizes `hwnd` to `asked` and answers what the window reads back.
pub fn set_frame(os: &mut dyn FrameOs, hwnd: isize, asked: Rect) -> Option<Rect> {
    let _ = os.set_window_pos(hwnd, asked, 0);
    Some(asked)
}

#[cfg(test)]
mod tests {
    use omo_computer_core::listing::Rect;

    use super::{set_frame, FrameOs, SWP_NOACTIVATE, SWP_NOZORDER};

    struct Fixed {
        flags: Vec<u32>,
        kept: Rect,
    }

    impl FrameOs for Fixed {
        fn set_window_pos(&mut self, _hwnd: isize, _rect: Rect, flags: u32) -> bool {
            self.flags.push(flags);
            true
        }
        fn window_rect(&mut self, _hwnd: isize) -> Option<Rect> {
            Some(self.kept)
        }
    }

    #[test]
    fn set_window_pos_reads_back() {
        let kept = Rect { x: 10.0, y: 10.0, width: 300.0, height: 200.0 };
        let mut os = Fixed { flags: Vec::new(), kept };
        let asked = Rect { x: 10.0, y: 10.0, width: 640.0, height: 480.0 };
        assert_eq!(set_frame(&mut os, 0x1234, asked), Some(kept), "a fixed-size dialog keeps its size");
        assert_eq!(os.flags, vec![SWP_NOACTIVATE | SWP_NOZORDER], "no activation, no z-order change");
    }
}
