//! The params readers: one function per params type that takes the decoded params by value,
//! destructures them with every field named (no `..`) and moves each value into the typed
//! request its consuming stage reads. A field added to a params type does not compile until
//! its reader names it; `protocol_test::readers` parses these files and fails on any field a
//! reader binds but never uses, and on any schema member no reader binds.

mod exec;
mod host;
mod legacy;
mod options;
mod reads;
mod session;
mod settings;
mod wait;

pub use exec::{
    read_apps_open, read_apps_quit, read_click, read_clipboard_write, read_drag, read_key_down,
    read_key_up, read_menu_select, read_mouse_down, read_mouse_up, read_move, read_paste,
    read_press, read_scroll, read_select_text, read_set_value, read_type, read_window,
    read_window_frame, CallAuthority, ExecRequest, SendPolicy, Verb, WindowVerb,
};
pub use host::{
    read_advance_clock, read_cancel, read_control_grant, read_stop_path_resume,
    read_stop_path_start, read_stop_path_stop, HostRequest,
};
pub use legacy::{
    read_ax_perform, read_ax_type_text, read_hold_keys, read_hold_mouse, read_key_chord,
    read_open_system_surface, read_raise_window, read_type_text, V1Request,
};
pub use options::{
    read_caps, read_observe_ax, read_observe_options, read_observe_request, read_point, read_rect,
    read_settle, read_text_range, At, AxSpec, ObserveSpec, Region, ScaleCaps, SettleSpec, TextSpan,
};
pub use reads::{
    read_ax_ref, read_ax_target, read_capture, read_drill, read_element_at, read_menu_items,
    read_observe, read_surface, read_wait_for, read_windows, read_zoom, ReadRequest,
};
pub use session::{read_key_priming, read_session_open, read_trace, SessionOpenRequest, TraceMode};
pub use settings::{
    read_settings, ArtifactConfig, CaptureConfig, ConsentConfig, FleetConfig, HostConfig,
    InputConfig, SessionConfig, StopConfig, TimingConfig,
};
pub use wait::{read_wait_predicate, SessionMatch, WaitSpec};

/// The directory these readers live in, relative to the crate root; the reader test parses it.
pub const READER_SOURCES: &str = "src/requests";
