//! libpipewire resolved at runtime with `libloading`, so the engine binary
//! never lists it as NEEDED and starts on hosts without PipeWire.

use std::ffi::{c_char, c_int, c_void};
use std::sync::OnceLock;

use libloading::Library;

use super::ffi::{
    PwBuffer, PwContext, PwCore, PwLoop, PwMainLoop, PwProperties, PwStream, PwStreamEvents, SpaHook, SpaPod,
};

pub const SONAME: &str = "libpipewire-0.3.so.0";

type PwInit = unsafe extern "C" fn(*mut c_int, *mut *mut *mut c_char);
type MainLoopNew = unsafe extern "C" fn(*const c_void) -> *mut PwMainLoop;
type MainLoopGetLoop = unsafe extern "C" fn(*mut PwMainLoop) -> *mut PwLoop;
type MainLoopAction = unsafe extern "C" fn(*mut PwMainLoop) -> c_int;
type MainLoopDestroy = unsafe extern "C" fn(*mut PwMainLoop);
type ContextNew = unsafe extern "C" fn(*mut PwLoop, *mut PwProperties, usize) -> *mut PwContext;
type ContextConnectFd = unsafe extern "C" fn(*mut PwContext, c_int, *mut PwProperties, usize) -> *mut PwCore;
type ContextDestroy = unsafe extern "C" fn(*mut PwContext);
type CoreDisconnect = unsafe extern "C" fn(*mut PwCore) -> c_int;
type PropertiesNewString = unsafe extern "C" fn(*const c_char) -> *mut PwProperties;
type StreamNew = unsafe extern "C" fn(*mut PwCore, *const c_char, *mut PwProperties) -> *mut PwStream;
type StreamAddListener =
    unsafe extern "C" fn(*mut PwStream, *mut SpaHook, *const PwStreamEvents, *mut c_void);
type StreamConnect = unsafe extern "C" fn(*mut PwStream, u32, u32, u32, *mut *const SpaPod, u32) -> c_int;
type StreamDequeue = unsafe extern "C" fn(*mut PwStream) -> *mut PwBuffer;
type StreamQueue = unsafe extern "C" fn(*mut PwStream, *mut PwBuffer) -> c_int;
type StreamDestroy = unsafe extern "C" fn(*mut PwStream);

/// The loaded library and every symbol the capture uses. The function
/// pointers stay valid because `_library` is never unloaded.
pub struct PipeWire {
    _library: Library,
    pub init: PwInit,
    pub main_loop_new: MainLoopNew,
    pub main_loop_get_loop: MainLoopGetLoop,
    pub main_loop_run: MainLoopAction,
    pub main_loop_quit: MainLoopAction,
    pub main_loop_destroy: MainLoopDestroy,
    pub context_new: ContextNew,
    pub context_connect_fd: ContextConnectFd,
    pub context_destroy: ContextDestroy,
    pub core_disconnect: CoreDisconnect,
    pub properties_new_string: PropertiesNewString,
    pub stream_new: StreamNew,
    pub stream_add_listener: StreamAddListener,
    pub stream_connect: StreamConnect,
    pub stream_dequeue_buffer: StreamDequeue,
    pub stream_queue_buffer: StreamQueue,
    pub stream_destroy: StreamDestroy,
}

macro_rules! symbols {
    ($library:ident; $($field:ident = $name:literal),+ $(,)?) => {{
        // SAFETY: each name is the documented libpipewire-0.3 export whose C
        // prototype matches the field's function-pointer type above.
        unsafe {
            PipeWire {
                $($field: *$library.get(concat!($name, "\0").as_bytes()).map_err(|error| format!("{}: {error}", $name))?,)+
                _library: $library,
            }
        }
    }};
}

impl PipeWire {
    fn load(soname: &str) -> Result<Self, String> {
        // SAFETY: loading libpipewire runs its ELF constructors, which only
        // register SPA types; nothing else is executed before `pw_init`.
        let library = unsafe { Library::new(soname) }.map_err(|error| format!("{soname}: {error}"))?;
        Ok(symbols!(library;
            init = "pw_init",
            main_loop_new = "pw_main_loop_new",
            main_loop_get_loop = "pw_main_loop_get_loop",
            main_loop_run = "pw_main_loop_run",
            main_loop_quit = "pw_main_loop_quit",
            main_loop_destroy = "pw_main_loop_destroy",
            context_new = "pw_context_new",
            context_connect_fd = "pw_context_connect_fd",
            context_destroy = "pw_context_destroy",
            core_disconnect = "pw_core_disconnect",
            properties_new_string = "pw_properties_new_string",
            stream_new = "pw_stream_new",
            stream_add_listener = "pw_stream_add_listener",
            stream_connect = "pw_stream_connect",
            stream_dequeue_buffer = "pw_stream_dequeue_buffer",
            stream_queue_buffer = "pw_stream_queue_buffer",
            stream_destroy = "pw_stream_destroy",
        ))
    }
}

/// libpipewire, loaded and initialized once per process; `Err` explains
/// why it is unavailable (the Screenshot portal is then the capture path).
pub fn pipewire() -> Result<&'static PipeWire, &'static str> {
    load_once(SONAME)
}

fn load_once(soname: &str) -> Result<&'static PipeWire, &'static str> {
    static LOADED: OnceLock<Result<PipeWire, String>> = OnceLock::new();
    let loaded = LOADED.get_or_init(|| {
        let pipewire = PipeWire::load(soname)?;
        // SAFETY: `pw_init` accepts null argc/argv and is idempotent.
        unsafe { (pipewire.init)(std::ptr::null_mut(), std::ptr::null_mut()) };
        Ok(pipewire)
    });
    loaded.as_ref().map_err(String::as_str)
}

#[cfg(test)]
pub fn loadable(soname: &str) -> bool {
    PipeWire::load(soname).is_ok()
}
