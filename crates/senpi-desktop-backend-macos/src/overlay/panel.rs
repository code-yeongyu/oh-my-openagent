//! AppKit objects stay on the helper main thread. No activation, key-window
//! operation, input posting or physical-cursor mutation is used here.
use super::{
    motion::{cocoa_origin, Frame},
    wire::Reply,
};
use objc2::rc::Retained;
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSCursor, NSFont, NSImageView, NSPanel, NSScreen, NSTextField,
    NSView, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::io;

const WIDTH: f64 = 76.0;
const HEIGHT: f64 = 42.0;

define_class!(
    // SAFETY: NSPanel superclass; override only its main-thread methods with
    // unchanged signatures and no object ivars.
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[ivars = ()]
    pub(super) struct CursorPanel;

    impl CursorPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key(&self) -> bool { false }
        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main(&self) -> bool { false }
    }
);

impl CursorPanel {
    pub fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(WIDTH, HEIGHT));
        let this = Self::alloc(mtm).set_ivars(());
        let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel;
        // SAFETY: mtm proves the main thread; allocated NSPanel subclass has
        // initialized ivars and all initializer arguments are values.
        let panel: Retained<Self> = unsafe {
            msg_send![super(this), initWithContentRect: rect, styleMask: style,
                backing: NSBackingStoreType::Buffered, defer: false]
        };
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(false);
        panel.setIgnoresMouseEvents(true);
        panel.setHidesOnDeactivate(false);
        panel.setBecomesKeyOnlyIfNeeded(true);
        panel.setLevel(1000);
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
        let view = NSView::initWithFrame(NSView::alloc(mtm), rect);
        // Reading an arrow image does not change the system cursor.
        let cursor = NSCursor::arrowCursor();
        let image = cursor.image();
        let hotspot = cursor.hotSpot();
        let size = image.size();
        let arrow = NSImageView::imageViewWithImage(&image, mtm);
        arrow.setFrame(NSRect::new(
            NSPoint::new(-hotspot.x, HEIGHT - size.height + hotspot.y),
            size,
        ));
        let label = NSTextField::labelWithString(&NSString::from_str("omo"), mtm);
        label.setFrame(NSRect::new(
            NSPoint::new(26.0, 8.0),
            NSSize::new(48.0, 26.0),
        ));
        label.setTextColor(Some(&NSColor::systemPinkColor()));
        label.setFont(Some(&NSFont::boldSystemFontOfSize(16.0)));
        view.addSubview(&arrow);
        view.addSubview(&label);
        panel.setContentView(Some(&view));
        panel.orderOut(None);
        panel
    }

    pub fn render(&self, frame: Option<Frame>, mtm: MainThreadMarker) -> io::Result<()> {
        let Some(frame) = frame.filter(|frame| frame.alpha > 0.0) else {
            self.orderOut(None);
            return Ok(());
        };
        let screens = NSScreen::screens(mtm);
        if screens.count() == 0 {
            return Err(io::Error::other(
                "no interactive display for cursor overlay",
            ));
        }
        let primary = screens.objectAtIndex(0).frame();
        let top = primary.origin.y + primary.size.height;
        let (x, y) = cocoa_origin(frame.x, frame.y, top, HEIGHT);
        self.setFrameOrigin(NSPoint::new(x, y));
        self.setAlphaValue(frame.alpha);
        self.orderFrontRegardless();
        Ok(())
    }

    pub fn reply(&self, token: u64) -> io::Result<Reply> {
        Ok(Reply {
            token,
            pid: std::process::id(),
            window_id: u32::try_from(self.windowNumber()).map_err(io::Error::other)?,
            visible: self.isVisible(),
            ignores_mouse_events: self.ignoresMouseEvents(),
            can_become_key: self.canBecomeKeyWindow(),
            can_become_main: self.canBecomeMainWindow(),
        })
    }
}
