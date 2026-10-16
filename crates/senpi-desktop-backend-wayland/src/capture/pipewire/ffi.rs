//! The PipeWire/SPA ABI this crate touches, mirrored from the PipeWire 1.4.2
//! headers (`spa/buffer/buffer.h`, `spa/utils/hook.h`, `spa/utils/list.h`,
//! `pipewire/stream.h`) and stable across PipeWire 1.x. Opaque objects are
//! empty enums; only the structs PipeWire hands back are laid out.

use std::ffi::{c_char, c_int, c_void};

pub enum PwMainLoop {}
pub enum PwLoop {}
pub enum PwContext {}
pub enum PwCore {}
pub enum PwStream {}
pub enum PwProperties {}
pub enum SpaPod {}

#[repr(C)]
pub struct SpaChunk {
    pub offset: u32,
    pub size: u32,
    pub stride: i32,
    pub flags: i32,
}

#[repr(C)]
pub struct SpaData {
    pub type_: u32,
    pub flags: u32,
    pub fd: i64,
    pub mapoffset: u32,
    pub maxsize: u32,
    pub data: *mut c_void,
    pub chunk: *mut SpaChunk,
}

#[repr(C)]
pub struct SpaBuffer {
    pub n_metas: u32,
    pub n_datas: u32,
    pub metas: *mut c_void,
    pub datas: *mut SpaData,
}

#[repr(C)]
pub struct PwBuffer {
    pub buffer: *mut SpaBuffer,
    pub user_data: *mut c_void,
    pub size: u64,
    pub requested: u64,
}

#[repr(C)]
pub struct SpaList {
    pub next: *mut SpaList,
    pub prev: *mut SpaList,
}

#[repr(C)]
pub struct SpaCallbacks {
    pub funcs: *const c_void,
    pub data: *mut c_void,
}

/// Zeroed by us, owned by PipeWire once registered: it must not move until
/// the stream is destroyed.
#[repr(C)]
pub struct SpaHook {
    pub link: SpaList,
    pub cb: SpaCallbacks,
    pub removed: Option<unsafe extern "C" fn(*mut SpaHook)>,
    pub priv_: *mut c_void,
}

impl SpaHook {
    pub const fn zeroed() -> Self {
        Self {
            link: SpaList {
                next: std::ptr::null_mut(),
                prev: std::ptr::null_mut(),
            },
            cb: SpaCallbacks {
                funcs: std::ptr::null(),
                data: std::ptr::null_mut(),
            },
            removed: None,
            priv_: std::ptr::null_mut(),
        }
    }
}

pub const PW_VERSION_STREAM_EVENTS: u32 = 2;
pub const PW_STREAM_STATE_ERROR: c_int = -1;
pub const PW_STREAM_FLAG_AUTOCONNECT: u32 = 1 << 0;
pub const PW_STREAM_FLAG_MAP_BUFFERS: u32 = 1 << 2;
pub const SPA_DIRECTION_INPUT: u32 = 0;
pub const SPA_PARAM_FORMAT: u32 = 4;

type Data = *mut c_void;

/// `struct pw_stream_events`, version 2: every callback this crate does not
/// use stays `None`.
#[repr(C)]
pub struct PwStreamEvents {
    pub version: u32,
    pub destroy: Option<unsafe extern "C" fn(Data)>,
    pub state_changed: Option<unsafe extern "C" fn(Data, c_int, c_int, *const c_char)>,
    pub control_info: Option<unsafe extern "C" fn(Data, u32, *const c_void)>,
    pub io_changed: Option<unsafe extern "C" fn(Data, u32, *mut c_void, u32)>,
    pub param_changed: Option<unsafe extern "C" fn(Data, u32, *const SpaPod)>,
    pub add_buffer: Option<unsafe extern "C" fn(Data, *mut PwBuffer)>,
    pub remove_buffer: Option<unsafe extern "C" fn(Data, *mut PwBuffer)>,
    pub process: Option<unsafe extern "C" fn(Data)>,
    pub drained: Option<unsafe extern "C" fn(Data)>,
    pub command: Option<unsafe extern "C" fn(Data, *const c_void)>,
    pub trigger_done: Option<unsafe extern "C" fn(Data)>,
}
