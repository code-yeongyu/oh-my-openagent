use super::object::{self, Object, Raw};
use block2::{Block, RcBlock};
use senpi_desktop_xpc::{
    identity::{SecurityVerifier, XpcMessage},
    roles::Role,
};
use std::{
    ffi::{c_char, CString},
    ptr,
    sync::mpsc,
    time::Duration,
};

type Handler = Block<dyn Fn(Raw)>;
// SAFETY: declarations match the public macOS SDK XPC connection ABI.
unsafe extern "C" {
    fn xpc_connection_create_mach_service(name: *const c_char, queue: Raw, flags: u64) -> Raw;
    fn xpc_connection_create_from_endpoint(endpoint: Raw) -> Raw;
    fn xpc_connection_set_peer_code_signing_requirement(
        connection: Raw,
        requirement: *const c_char,
    ) -> i32;
    fn xpc_connection_set_event_handler(connection: Raw, handler: &Handler);
    fn xpc_connection_resume(connection: Raw);
    pub(super) fn xpc_connection_cancel(connection: Raw);
    pub(super) fn xpc_connection_send_message(connection: Raw, message: Raw);
    fn xpc_connection_send_message_with_reply(
        connection: Raw,
        message: Raw,
        queue: Raw,
        handler: &Handler,
    );
}

pub(super) struct Connection {
    object: Object,
    events: mpsc::Receiver<Result<Object, String>>,
}

fn received(raw: Raw) -> Result<Object, String> {
    // SAFETY: only XPC invokes the containing callback with this live object.
    if unsafe { object::xpc_get_type(raw) } != ptr::addr_of!(object::_xpc_type_dictionary).cast() {
        return Err("disconnected".to_owned());
    }
    let pointer = ptr::NonNull::new(raw).ok_or("null callback")?;
    // SAFETY: raw is an actual received dictionary alive for this callback.
    let message = unsafe { XpcMessage::from_raw(pointer) };
    SecurityVerifier::from_xpc_message(message)
        .verify_server()
        .map_err(|_| "untrusted-server".to_owned())?;
    // SAFETY: retain this live verified callback object before the callback ends.
    unsafe { Object::retained(raw) }
}

impl Connection {
    pub(super) fn named(name: &str) -> Result<Self, String> {
        let name = CString::new(name).map_err(|error| error.to_string())?;
        // SAFETY: valid service C string, default queue, client flags.
        let raw = unsafe { xpc_connection_create_mach_service(name.as_ptr(), ptr::null_mut(), 0) };
        // SAFETY: the create function transfers one owned reference.
        Self::activate(unsafe { Object::owned(raw) }?)
    }

    pub(super) fn endpoint(reply: &Object) -> Result<Self, String> {
        let endpoint = reply.endpoint()?;
        // SAFETY: reply owns the checked endpoint throughout creation.
        let raw = unsafe { xpc_connection_create_from_endpoint(endpoint) };
        // SAFETY: the create function transfers one owned reference.
        Self::activate(unsafe { Object::owned(raw) }?)
    }

    fn activate(object: Object) -> Result<Self, String> {
        let requirement =
            CString::new(Role::EngineServer.requirement()).map_err(|error| error.to_string())?;
        // SAFETY: inactive connection, valid immutable C string.
        let status = unsafe {
            xpc_connection_set_peer_code_signing_requirement(object.raw(), requirement.as_ptr())
        };
        if status != 0 {
            std::mem::forget(object);
            return Err(format!("requirement={status}"));
        }
        let (tx, events) = mpsc::channel();
        let handler = RcBlock::new(move |raw| {
            if tx.send(received(raw)).is_err() {
                eprintln!("fixture event receiver closed");
            }
        });
        // SAFETY: XPC copies the static callback containing a Send channel sender.
        unsafe { xpc_connection_set_event_handler(object.raw(), &handler) };
        // SAFETY: reciprocal requirement and handler are installed before activation.
        unsafe { xpc_connection_resume(object.raw()) };
        Ok(Self { object, events })
    }

    pub(super) fn exchange(&self, request: &Object) -> Result<Object, String> {
        let (tx, rx) = mpsc::channel();
        let callback = RcBlock::new(move |raw| {
            if tx.send(received(raw)).is_err() {
                eprintln!("fixture reply receiver closed");
            }
        });
        // SAFETY: connection and dictionary remain alive; XPC copies the static block.
        unsafe {
            xpc_connection_send_message_with_reply(
                self.object.raw(),
                request.raw(),
                ptr::null_mut(),
                &callback,
            )
        };
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|error| format!("reply timeout: {error}"))?
    }

    pub(super) fn send(&self, request: &Object) {
        // SAFETY: live connection and dictionary; XPC copies the dictionary.
        unsafe { xpc_connection_send_message(self.object.raw(), request.raw()) };
    }

    pub(super) fn next(&self) -> Result<Object, String> {
        self.events
            .recv_timeout(Duration::from_secs(10))
            .map_err(|error| format!("event timeout: {error}"))?
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // SAFETY: Connection is created only after activation.
        unsafe { xpc_connection_cancel(self.object.raw()) };
    }
}

pub(super) fn squatter(name: &str) -> Result<(), String> {
    let name = CString::new(name).map_err(|error| error.to_string())?;
    // SAFETY: fixed fixture name, default queue, listener flag.
    let raw = unsafe { xpc_connection_create_mach_service(name.as_ptr(), ptr::null_mut(), 1) };
    // SAFETY: create transfers one owned reference.
    let listener = unsafe { Object::owned(raw) }?;
    let handler = RcBlock::new(|peer| {
        // SAFETY: peer is the live listener callback argument.
        if unsafe { object::xpc_get_type(peer) }
            != ptr::addr_of!(object::_xpc_type_connection).cast()
        {
            return;
        }
        let callback = RcBlock::new(move |raw| {
            // SAFETY: raw is the live accepted connection callback argument.
            if unsafe { object::xpc_get_type(raw) }
                != ptr::addr_of!(object::_xpc_type_dictionary).cast()
            {
                return;
            }
            // SAFETY: retain the live dictionary for the duration of this handler.
            let result = unsafe { Object::retained(raw) }.and_then(|request| {
                let public = request.count() == 2 && request.data(c"challenge")?.len() == 32;
                println!("SQUATTER public_only={public} fields={}", request.count());
                let mut reply = request.reply()?;
                reply.put_uint(c"version", 1);
                reply.put_data(c"challenge", request.data(c"challenge")?);
                // SAFETY: peer is live for this callback; reply carries its reply context.
                unsafe { xpc_connection_send_message(peer, reply.raw()) };
                Ok::<(), String>(())
            });
            if let Err(error) = result {
                eprintln!("SQUATTER_FAILED {error}");
            }
        });
        // SAFETY: fixture peer is inactive; XPC copies this static callback.
        unsafe { xpc_connection_set_event_handler(peer, &callback) };
        // SAFETY: this intentionally untrusted test server installed its callback.
        unsafe { xpc_connection_resume(peer) };
    });
    // SAFETY: fixture listener owns its live inactive reference and static handler.
    unsafe { xpc_connection_set_event_handler(listener.raw(), &handler) };
    // SAFETY: handler installed; the squatter intentionally has no trust requirement.
    unsafe { xpc_connection_resume(listener.raw()) };
    std::thread::park();
    // SAFETY: activated fixture listener is still owned here.
    unsafe { xpc_connection_cancel(listener.raw()) };
    Ok(())
}
