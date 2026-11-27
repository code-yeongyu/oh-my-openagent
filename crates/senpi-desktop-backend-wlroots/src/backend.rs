//! `WlrootsBackend`: windows and displays from the sway tree, grim capture,
//! wtype keys, a direct virtual pointer, and focus through sway IPC, with
//! capabilities measured from what actually answered (the X11 backend's
//! honesty model, on sway's native tools).

use image::RgbaImage;
use senpi_desktop_core::backend::{Backend, DeliveryMode, Modifiers, MouseButton, PointerEvent};
use senpi_desktop_core::error::{CoreResult, DesktopError};
use senpi_desktop_core::frame::FrameGeometry;
use senpi_desktop_core::keys::KeyName;
use senpi_desktop_core::types::{
    CaptureCaps, DesktopCapabilities, DesktopDisplay, DesktopPoint, DesktopWindow, DisplaySelector,
    FrontWindow, Target, WindowInput,
};

use crate::capture;
use crate::command::{CommandRunner, ProcessRunner};
use crate::input;
use crate::ipc::{self, SwayIpc, SwaySocket};
use crate::pointer::{VirtualPointer, BTN_LEFT, BTN_MIDDLE, BTN_RIGHT};

pub struct WlrootsBackend<R: CommandRunner = ProcessRunner, S: SwayIpc = SwaySocket> {
    pub(crate) ipc: S,
    pub(crate) runner: R,
    input: Option<DesktopError>,
    pointer: Result<VirtualPointer, DesktopError>,
    selector: DisplaySelector,
    display_server: Option<String>,
}

impl WlrootsBackend<ProcessRunner, SwaySocket> {
    /// Connects to the compositor `SWAYSOCK` names and proves capture with a
    /// one-pixel screencopy. Input halves are optional: without `wtype` or
    /// the virtual pointer protocol the backend still captures and reports
    /// input unavailable.
    ///
    /// # Errors
    /// `CaptureFailed` when the sway socket cannot be connected or grim
    /// cannot capture.
    pub fn new(selector: DisplaySelector) -> CoreResult<Self> {
        let socket = crate::sway_socket_path(&|name| std::env::var_os(name)).ok_or_else(|| {
            DesktopError::capture_failed("SWAYSOCK is not set or its socket is gone")
        })?;
        let ipc = SwaySocket::connect(&socket)?;
        Self::open(
            ipc,
            ProcessRunner,
            selector,
            None,
            std::env::var("WAYLAND_DISPLAY").ok(),
        )
    }
}

impl<R: CommandRunner, S: SwayIpc> WlrootsBackend<R, S> {
    /// Measures what this session can do: grim proves screencopy, wtype
    /// proves the keyboard path, the virtual pointer proves pointer input.
    /// `display_server` is what `capabilities` reports (the `WAYLAND_DISPLAY`
    /// the session runs on).
    ///
    /// # Errors
    /// `CaptureFailed` when grim cannot capture.
    pub fn open(
        ipc: S,
        runner: R,
        selector: DisplaySelector,
        pointer_socket: Option<&std::path::Path>,
        display_server: Option<String>,
    ) -> CoreResult<Self> {
        let mut runner = runner;
        capture::probe(&mut runner)?;
        let input = input::probe(&mut runner);
        if let Some(error) = input.as_ref() {
            eprintln!(
                "senpi-desktop-backend-wlroots: wtype unavailable: {}",
                error.message
            );
        }
        let pointer = VirtualPointer::connect(pointer_socket);
        if let Err(error) = pointer.as_ref() {
            eprintln!(
                "senpi-desktop-backend-wlroots: virtual pointer unavailable: {}",
                error.message
            );
        }
        Ok(Self {
            ipc,
            runner,
            input,
            pointer,
            selector,
            display_server,
        })
    }

    /// The layout extent `motion_absolute` positions within, read fresh so a
    /// layout change cannot scale clicks into the wrong place.
    fn layout_extent(&mut self) -> CoreResult<(u32, u32)> {
        let displays = self.displays()?;
        let width = displays
            .iter()
            .map(|display| {
                display
                    .x
                    .saturating_add(i32::try_from(display.width).unwrap_or(i32::MAX))
            })
            .max()
            .unwrap_or(1);
        let height = displays
            .iter()
            .map(|display| {
                display
                    .y
                    .saturating_add(i32::try_from(display.height).unwrap_or(i32::MAX))
            })
            .max()
            .unwrap_or(1);
        Ok((
            u32::try_from(width.max(1)).unwrap_or(1),
            u32::try_from(height.max(1)).unwrap_or(1),
        ))
    }

    fn keyboard(&mut self) -> Result<(), DesktopError> {
        self.input
            .as_ref()
            .map_or(Ok(()), |error| Err(error.clone()))
    }

    /// Window-addressed delivery on wlroots follows the focused surface, so
    /// it cannot stay in the background: a background window request is
    /// refused with nothing sent, and a foreground request (which the
    /// session's grant gate admits only under a live control grant) focuses
    /// the target first so the global keyboard and pointer reach it.
    fn window_delivery(&mut self, target: &Target, mode: DeliveryMode) -> CoreResult<()> {
        if let Target::Window(id) = target {
            if mode == DeliveryMode::Background {
                return Err(DesktopError::background_unavailable(format!(
                    "window {id} wlroots-focus-only: input follows the focused surface, so a window \
                     needs foreground delivery, which focuses it first under the control grant"
                )));
            }
            self.focus_window(id)?;
        }
        Ok(())
    }

    /// Focuses the window through sway IPC; sway can activate any container
    /// its tree names, unlike the portal-mediated Wayland constraint.
    fn focus_window(&mut self, id: &str) -> CoreResult<()> {
        let tree = ipc::tree(&mut self.ipc)?;
        if tree.find(id).is_none() {
            return Err(DesktopError::window_not_found(format!(
                "window {id} was not found in the sway tree"
            )));
        }
        ipc::run_command(&mut self.ipc, &format!("[con_id={id}] focus"))
    }

    fn motion(&mut self, x: f64, y: f64) -> CoreResult<()> {
        let (extent_x, extent_y) = self.layout_extent()?;
        let clamp = |value: f64, extent: u32| -> u32 {
            let limit = f64::from(extent.saturating_sub(1));
            value.round().clamp(0.0, limit).max(0.0) as u32
        };
        let x = clamp(x, extent_x);
        let y = clamp(y, extent_y);
        self.pointer
            .as_mut()
            .map_err(|error| error.clone())?
            .motion_absolute(x, y, extent_x, extent_y)
    }

    fn click_button(&mut self, button: MouseButton, count: u32) -> CoreResult<()> {
        let code = match button {
            MouseButton::Left => BTN_LEFT,
            MouseButton::Right => BTN_RIGHT,
            MouseButton::Middle => BTN_MIDDLE,
        };
        for _ in 0..count.max(1) {
            let pointer = self.pointer.as_mut().map_err(|error| error.clone())?;
            pointer.button(code, true)?;
            pointer.button(code, false)?;
        }
        Ok(())
    }

    /// wtype holds a modifier only while its own process lives, so a
    /// modifier press would be released before the pointer event it was
    /// meant to hold through; refusing keeps the delivery honest.
    fn refuse_pointer_modifiers(modifiers: Modifiers) -> CoreResult<()> {
        if modifiers.ctrl || modifiers.alt || modifiers.shift || modifiers.meta {
            return Err(DesktopError::input_failed(
                "pointer modifiers are unavailable on wlroots: wtype holds a modifier only within one \
                 process, so a modifier click or drag cannot be delivered honestly; use a key chord for \
                 the modifier instead",
            ));
        }
        Ok(())
    }
}

impl<R: CommandRunner, S: SwayIpc> Backend for WlrootsBackend<R, S> {
    fn capabilities(&mut self) -> DesktopCapabilities {
        let displays = self.displays().unwrap_or_default();
        let capture = !displays.is_empty();
        let input = self.input.is_none() && self.pointer.is_ok();
        let granted = |ok: bool| if ok { "granted" } else { "unavailable" };
        DesktopCapabilities {
            backend: "wlroots".to_owned(),
            display_server: self.display_server.clone(),
            capture,
            input,
            ax: false,
            // Window-addressed input works only through foreground delivery,
            // which focuses the target first under the control grant.
            background_window_input: false,
            delivery_modes: if input {
                vec!["background".to_owned(), "foreground".to_owned()]
            } else {
                Vec::new()
            },
            capture_permission: granted(capture).to_owned(),
            input_permission: granted(input).to_owned(),
            ax_permission: "unavailable".to_owned(),
            display_count: u32::try_from(displays.len()).unwrap_or(u32::MAX),
            focus_guard: false,
            window_input: Some(WindowInput {
                available: input,
                reason: (!input).then(|| "no-virtual-pointer".to_owned()),
            }),
            ..DesktopCapabilities::unavailable()
        }
    }

    fn displays(&mut self) -> CoreResult<Vec<DesktopDisplay>> {
        ipc::outputs(&mut self.ipc)
    }

    fn windows(&mut self) -> CoreResult<Vec<DesktopWindow>> {
        let (windows, _) = ipc::tree(&mut self.ipc)?.windows();
        Ok(windows)
    }

    fn capture(
        &mut self,
        target: &Target,
        _caps: &CaptureCaps,
        _exclude_window_titles: &[String],
    ) -> CoreResult<(RgbaImage, FrameGeometry)> {
        let selector = self.selector.clone();
        capture::capture(&mut self.runner, &mut self.ipc, target, &selector)
    }

    fn pointer(
        &mut self,
        target: &Target,
        event: PointerEvent,
        _frame: &FrameGeometry,
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        self.window_delivery(target, mode)?;
        match event {
            PointerEvent::Move { x, y } => self.motion(x, y),
            PointerEvent::Click {
                x,
                y,
                button,
                count,
                modifiers,
            } => {
                Self::refuse_pointer_modifiers(modifiers)?;
                self.motion(x, y)
                    .and_then(|()| self.click_button(button, count))
            }
            PointerEvent::Drag {
                path,
                button,
                modifiers,
            } => {
                if path.is_empty() {
                    return Ok(());
                }
                Self::refuse_pointer_modifiers(modifiers)?;
                self.drag(path, button)
            }
            PointerEvent::Scroll { x, y, dx, dy } => {
                self.motion(x, y)?;
                self.pointer
                    .as_mut()
                    .map_err(|error| error.clone())?
                    .scroll(dx, dy)
            }
        }
    }

    fn type_text(&mut self, target: &Target, text: &str, mode: DeliveryMode) -> CoreResult<()> {
        self.window_delivery(target, mode)?;
        self.keyboard()?;
        input::type_text(&mut self.runner, text)
    }

    fn type_text_interruptible(
        &mut self,
        target: &Target,
        text: &str,
        mode: DeliveryMode,
        check_stop: &dyn Fn() -> CoreResult<()>,
        delivered: &mut dyn FnMut(),
    ) -> CoreResult<()> {
        // The gate is consulted before any side effect: no focus command,
        // no spawned child, when it already refuses.
        check_stop()?;
        self.window_delivery(target, mode)?;
        self.keyboard()?;
        input::type_text_interruptible(&mut self.runner, text, check_stop, delivered)
    }

    fn clipboard_read(&mut self) -> CoreResult<String> {
        senpi_desktop_core::clipboard::read_text()
    }

    fn clipboard_write(&mut self, text: &str) -> CoreResult<()> {
        senpi_desktop_core::clipboard::write_text(text)
    }

    fn key_chord(
        &mut self,
        target: &Target,
        keys: &[KeyName],
        mode: DeliveryMode,
    ) -> CoreResult<()> {
        self.window_delivery(target, mode)?;
        self.keyboard()?;
        input::key_chord(&mut self.runner, keys)
    }

    /// Focuses the window through sway IPC; sway can activate any container
    /// its tree names, unlike the portal-mediated Wayland constraint.
    fn raise_window(&mut self, id: &str) -> CoreResult<()> {
        self.focus_window(id)
    }

    fn ax(&mut self) -> Option<&mut dyn senpi_desktop_core::ax::AxBackend> {
        None
    }

    /// Lifts every button the virtual pointer still holds; wtype releases
    /// its own keys when its process exits.
    fn release_all(&mut self) -> CoreResult<()> {
        match &mut self.pointer {
            Ok(pointer) => pointer.release_all(),
            Err(_) => Ok(()),
        }
    }

    fn front_window(&mut self) -> CoreResult<Option<FrontWindow>> {
        let (windows, _) = ipc::tree(&mut self.ipc)?.windows();
        let Some(focused) = windows.into_iter().find(|window| window.focused) else {
            return Ok(None);
        };
        Ok(Some(FrontWindow {
            pid: focused.pid.unwrap_or(0),
            app: focused.app.clone(),
            window_id: Some(focused.id.clone()),
            key_window_ax_title: Some(focused.title.clone()),
        }))
    }

    fn cursor_position(&mut self) -> CoreResult<Option<DesktopPoint>> {
        Ok(None)
    }
}

impl<R: CommandRunner, S: SwayIpc> WlrootsBackend<R, S> {
    fn drag(&mut self, path: Vec<(f64, f64)>, button: MouseButton) -> CoreResult<()> {
        let code = match button {
            MouseButton::Left => BTN_LEFT,
            MouseButton::Right => BTN_RIGHT,
            MouseButton::Middle => BTN_MIDDLE,
        };
        let Some(&(start_x, start_y)) = path.first() else {
            return Ok(());
        };
        self.motion(start_x, start_y)?;
        self.pointer
            .as_mut()
            .map_err(|error| error.clone())?
            .button(code, true)?;
        for (x, y) in path.iter().skip(1) {
            self.motion(*x, *y)?;
        }
        self.pointer
            .as_mut()
            .map_err(|error| error.clone())?
            .button(code, false)
    }
}
