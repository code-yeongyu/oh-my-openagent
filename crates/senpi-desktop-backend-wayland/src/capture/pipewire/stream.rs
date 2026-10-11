//! One frame from a ScreenCast PipeWire node: connect over the portal's
//! remote fd, negotiate a packed RGB format, copy the first buffer, quit.
//! Everything PipeWire calls back into lives in one heap `Grab` that
//! outlives the main loop run.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::os::fd::{IntoRawFd, OwnedFd};
use std::ptr;

use image::RgbaImage;

use super::ffi::{
    PwBuffer, PwMainLoop, PwStream, PwStreamEvents, SpaHook, SpaPod, PW_STREAM_FLAG_AUTOCONNECT,
    PW_STREAM_FLAG_MAP_BUFFERS, PW_STREAM_STATE_ERROR, PW_VERSION_STREAM_EVENTS, SPA_DIRECTION_INPUT,
    SPA_PARAM_FORMAT,
};
use super::lib::PipeWire;
use super::pixels::to_rgba;
use super::pod::{enum_format, parse_format, Negotiated};

const STREAM_PROPERTIES: &CStr = c"media.type=Video media.category=Capture media.role=Screen";

struct Grab {
    pipewire: &'static PipeWire,
    main_loop: *mut PwMainLoop,
    stream: *mut PwStream,
    format: Option<Negotiated>,
    result: Option<Result<RgbaImage, String>>,
}

impl Grab {
    fn finish(&mut self, result: Result<RgbaImage, String>) {
        if self.result.is_none() {
            self.result = Some(result);
            // SAFETY: `main_loop` is alive for the whole run that invokes callbacks.
            unsafe { (self.pipewire.main_loop_quit)(self.main_loop) };
        }
    }

    /// Copies the first mapped buffer; `Ok(false)` waits for another one.
    fn take_frame(&mut self, buffer: *mut PwBuffer) -> Result<bool, String> {
        let format = self.format.ok_or("PipeWire sent a frame before a format")?;
        // SAFETY: PipeWire returns a valid `pw_buffer` from `dequeue` with a
        // `spa_buffer` whose `datas` array has `n_datas` entries.
        let data = unsafe {
            let spa = (*buffer).buffer;
            if spa.is_null() || (*spa).n_datas == 0 {
                return Ok(false);
            }
            &*(*spa).datas
        };
        if data.data.is_null() || data.chunk.is_null() {
            return Err("PipeWire frame buffer is not memory-mapped (MAP_BUFFERS)".to_owned());
        }
        // SAFETY: `chunk` is non-null and valid while the buffer is dequeued.
        let chunk = unsafe { &*data.chunk };
        let stride =
            usize::try_from(chunk.stride).map_err(|_| format!("unsupported stride {}", chunk.stride))?;
        let maxsize = data.maxsize as usize;
        let offset = (chunk.offset as usize) % maxsize.max(1);
        let size = (chunk.size as usize).min(maxsize.saturating_sub(offset));
        if size == 0 {
            return Ok(false);
        }
        // SAFETY: with MAP_BUFFERS `data` maps `maxsize` bytes, and
        // `offset + size <= maxsize` by the clamps above.
        let bytes = unsafe { std::slice::from_raw_parts(data.data.cast::<u8>().add(offset), size) };
        self.finish(to_rgba(format, bytes, stride));
        Ok(true)
    }
}

unsafe extern "C" fn on_state(data: *mut c_void, _old: c_int, state: c_int, error: *const c_char) {
    // SAFETY: `data` is the `Grab` registered with the listener.
    let grab = unsafe { &mut *data.cast::<Grab>() };
    if state == PW_STREAM_STATE_ERROR {
        let reason = if error.is_null() {
            "unknown error".to_owned()
        } else {
            // SAFETY: PipeWire passes a NUL-terminated message or null.
            unsafe { CStr::from_ptr(error) }.to_string_lossy().into_owned()
        };
        grab.finish(Err(format!("PipeWire stream error: {reason}")));
    }
}

unsafe extern "C" fn on_param(data: *mut c_void, id: u32, param: *const SpaPod) {
    // SAFETY: `data` is the registered `Grab`.
    let grab = unsafe { &mut *data.cast::<Grab>() };
    if id != SPA_PARAM_FORMAT || param.is_null() {
        return;
    }
    // SAFETY: a spa_pod starts with its u32 body size; the whole pod is that
    // plus the 8-byte header, valid for the duration of the callback.
    let pod = unsafe {
        let size = ptr::read_unaligned(param.cast::<u32>()) as usize;
        std::slice::from_raw_parts(param.cast::<u8>(), size + 8)
    };
    match parse_format(pod) {
        Some(format) => grab.format = Some(format),
        None => grab.finish(Err(
            "PipeWire negotiated a format this capture cannot read".to_owned()
        )),
    }
}

unsafe extern "C" fn on_process(data: *mut c_void) {
    // SAFETY: `data` is the registered `Grab`.
    let grab = unsafe { &mut *data.cast::<Grab>() };
    // SAFETY: `stream` is alive while the loop runs.
    let buffer = unsafe { (grab.pipewire.stream_dequeue_buffer)(grab.stream) };
    if buffer.is_null() {
        return;
    }
    if let Err(message) = grab.take_frame(buffer) {
        grab.finish(Err(message));
    }
    // SAFETY: returns the buffer dequeued above to the same stream.
    unsafe { (grab.pipewire.stream_queue_buffer)(grab.stream, buffer) };
}

static EVENTS: PwStreamEvents = PwStreamEvents {
    version: PW_VERSION_STREAM_EVENTS,
    destroy: None,
    state_changed: Some(on_state),
    control_info: None,
    io_changed: None,
    param_changed: Some(on_param),
    add_buffer: None,
    remove_buffer: None,
    process: Some(on_process),
    drained: None,
    command: None,
    trigger_done: None,
};

pub fn grab_frame(pipewire: &'static PipeWire, node: u32, fd: OwnedFd) -> Result<RgbaImage, String> {
    // SAFETY: libpipewire's lifecycle order (loop, context, core, stream;
    // torn down in the opposite order) with each pointer null-checked first.
    // `run_stream` boxes the callback state and hook so their addresses are
    // fixed while PipeWire holds them and destroys the stream before either drops.
    unsafe {
        let main_loop = (pipewire.main_loop_new)(ptr::null());
        if main_loop.is_null() {
            return Err("pw_main_loop_new failed".to_owned());
        }
        let context = (pipewire.context_new)((pipewire.main_loop_get_loop)(main_loop), ptr::null_mut(), 0);
        let outcome = if context.is_null() {
            Err("pw_context_new failed".to_owned())
        } else {
            let core = (pipewire.context_connect_fd)(context, fd.into_raw_fd(), ptr::null_mut(), 0);
            let outcome = if core.is_null() {
                Err("PipeWire refused the portal remote".to_owned())
            } else {
                let outcome = run_stream(pipewire, main_loop, core, node);
                (pipewire.core_disconnect)(core);
                outcome
            };
            (pipewire.context_destroy)(context);
            outcome
        };
        (pipewire.main_loop_destroy)(main_loop);
        outcome
    }
}

/// # Safety
/// `main_loop` and `core` are live libpipewire objects of the calling thread.
unsafe fn run_stream(
    pipewire: &'static PipeWire,
    main_loop: *mut PwMainLoop,
    core: *mut super::ffi::PwCore,
    node: u32,
) -> Result<RgbaImage, String> {
    // SAFETY: see `grab_frame`; the stream is destroyed before `grab` and
    // `hook` drop at the end of this function.
    unsafe {
        let properties = (pipewire.properties_new_string)(STREAM_PROPERTIES.as_ptr());
        let stream = (pipewire.stream_new)(core, c"senpi-desktop-capture".as_ptr(), properties);
        if stream.is_null() {
            return Err("pw_stream_new failed".to_owned());
        }
        let mut grab = Box::new(Grab {
            pipewire,
            main_loop,
            stream,
            format: None,
            result: None,
        });
        let mut hook = Box::new(SpaHook::zeroed());
        let grab_ptr: *mut Grab = &mut *grab;
        (pipewire.stream_add_listener)(stream, &mut *hook, &EVENTS, grab_ptr.cast());
        let format = enum_format();
        let mut params = [format.as_ptr().cast::<SpaPod>()];
        let flags = PW_STREAM_FLAG_AUTOCONNECT | PW_STREAM_FLAG_MAP_BUFFERS;
        let connected =
            (pipewire.stream_connect)(stream, SPA_DIRECTION_INPUT, node, flags, params.as_mut_ptr(), 1);
        if connected < 0 {
            (pipewire.stream_destroy)(stream);
            return Err(format!("pw_stream_connect failed ({connected})"));
        }
        (pipewire.main_loop_run)(main_loop);
        (pipewire.stream_destroy)(stream);
        drop(hook);
        grab.result
            .take()
            .unwrap_or_else(|| Err("PipeWire stream ended before producing a frame".to_owned()))
    }
}
