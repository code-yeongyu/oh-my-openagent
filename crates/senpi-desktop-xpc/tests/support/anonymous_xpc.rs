//! Test-only libSystem XPC bindings. No service registration or backend exists.
use block2::{Block, RcBlock};
use senpi_desktop_xpc::{
    identity::{SecurityVerifier, XpcMessage},
    RejectReason, VerifiedPeer,
};
use std::{
    ffi::{c_char, c_void},
    ptr::{self, NonNull},
    sync::mpsc::Sender,
};

type Raw = *mut c_void;
type Handler = Block<dyn Fn(Raw)>;

unsafe extern "C" {
    fn xpc_connection_create(name: *const c_char, queue: Raw) -> Raw;
    fn xpc_endpoint_create(listener: Raw) -> Raw;
    fn xpc_connection_create_from_endpoint(endpoint: Raw) -> Raw;
    fn xpc_connection_set_event_handler(connection: Raw, handler: &Handler);
    fn xpc_connection_resume(connection: Raw);
    fn xpc_connection_cancel(connection: Raw);
    fn xpc_connection_send_message(connection: Raw, message: Raw);
    fn xpc_dictionary_create(keys: *const *const c_char, values: *const Raw, count: usize) -> Raw;
    fn xpc_dictionary_get_remote_connection(message: Raw) -> Raw;
    fn xpc_get_type(object: Raw) -> *const c_void;
    fn xpc_release(object: Raw);
    static _xpc_type_connection: u8;
    static _xpc_type_dictionary: u8;
}

struct Object {
    pointer: NonNull<c_void>,
    connection: bool,
}

impl Object {
    // All callers supply +1 results from the corresponding XPC creation API.
    fn created(raw: Raw, connection: bool) -> Self {
        Self {
            pointer: NonNull::new(raw).expect("XPC creation returned null"),
            connection,
        }
    }

    fn raw(&self) -> Raw {
        self.pointer.as_ptr()
    }

    fn activate(&self, handler: &Handler) {
        // SAFETY: self owns a live inactive connection. XPC copies the block;
        // callers provide 'static closures whose captured channel senders are Send.
        unsafe { xpc_connection_set_event_handler(self.raw(), handler) };
        // SAFETY: the handler is installed and the owned connection is inactive.
        unsafe { xpc_connection_resume(self.raw()) };
    }
}

impl Drop for Object {
    fn drop(&mut self) {
        if self.connection {
            // SAFETY: every owned connection was resumed by Pair::new.
            unsafe { xpc_connection_cancel(self.raw()) };
        }
        // SAFETY: Object owns exactly one Create-rule reference.
        unsafe { xpc_release(self.raw()) };
    }
}

fn receive(event: Raw, tx: &Sender<Result<VerifiedPeer, RejectReason>>) {
    // SAFETY: XPC keeps the event object alive throughout this callback.
    let kind = unsafe { xpc_get_type(event) };
    if kind != ptr::addr_of!(_xpc_type_dictionary).cast() {
        return;
    }
    let Some(pointer) = NonNull::new(event) else {
        return;
    };
    // SAFETY: the received dictionary is live and unmodified for this callback;
    // verification completes before the borrow or callback ends.
    let message = unsafe { XpcMessage::from_raw(pointer) };
    let verdict = SecurityVerifier::from_xpc_message(message).verify_privileged_client();
    // SAFETY: XPC provided this dictionary, so its remote connection is live.
    let remote = unsafe { xpc_dictionary_get_remote_connection(event) };
    if !remote.is_null() {
        // SAFETY: the live received peer is accepted and can now be canceled.
        unsafe { xpc_connection_cancel(remote) };
    }
    // The receiver may have timed out; returning drops verdict and captures.
    if tx.send(verdict).is_err() {
        eprintln!("XPC verdict receiver was dropped");
    }
}

fn accept(event: Raw, tx: &Sender<Result<VerifiedPeer, RejectReason>>) {
    // SAFETY: XPC keeps the event object alive throughout this callback.
    let kind = unsafe { xpc_get_type(event) };
    if kind != ptr::addr_of!(_xpc_type_connection).cast() {
        return;
    }
    let tx = tx.clone();
    let handler = RcBlock::new(move |message| receive(message, &tx));
    // SAFETY: the listener received a live inactive peer; the copied handler
    // owns only a Send channel sender, and XPC serializes callbacks per peer.
    unsafe { xpc_connection_set_event_handler(event, &handler) };
    // SAFETY: accepting a received peer requires installing a handler and resuming.
    unsafe { xpc_connection_resume(event) };
}

pub struct Pair {
    client: Object,
    _endpoint: Object,
    _listener: Object,
}

impl Pair {
    pub fn new(tx: Sender<Result<VerifiedPeer, RejectReason>>) -> Self {
        // SAFETY: NULL name creates an anonymous listener; NULL selects the default queue.
        let listener = Object::created(
            unsafe { xpc_connection_create(ptr::null(), ptr::null_mut()) },
            true,
        );
        let handler = RcBlock::new(move |event| accept(event, &tx));
        listener.activate(&handler);
        // SAFETY: listener is a live activated anonymous listener.
        let endpoint = Object::created(unsafe { xpc_endpoint_create(listener.raw()) }, false);
        // SAFETY: endpoint owns a live endpoint object.
        let client = Object::created(
            unsafe { xpc_connection_create_from_endpoint(endpoint.raw()) },
            true,
        );
        client.activate(&RcBlock::new(|_| {}));
        Self {
            client,
            _endpoint: endpoint,
            _listener: listener,
        }
    }

    pub fn send_dictionary(&self) {
        // SAFETY: zero pairs permits NULL arrays; the result has +1 ownership.
        let message = Object::created(
            unsafe { xpc_dictionary_create(ptr::null(), ptr::null(), 0) },
            false,
        );
        // SAFETY: client and dictionary remain alive; XPC retains a queued message.
        unsafe { xpc_connection_send_message(self.client.raw(), message.raw()) };
    }
}
