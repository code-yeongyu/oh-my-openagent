//! Signed process fixture only. This module does not exist in a production build.
use clap::Parser;
use std::path::PathBuf;

#[derive(Clone, Default)]
pub(crate) struct Observers(std::sync::Arc<std::sync::Mutex<Vec<std::thread::JoinHandle<()>>>>);

impl senpi_desktop_session::BackendFactory for Observers {
    fn create(&self, _: &senpi_desktop_core::types::DesktopSessionOptions)
        -> senpi_desktop_core::error::CoreResult<Box<dyn senpi_desktop_core::backend::Backend>> {
        use senpi_desktop_backend_fake::{FakeBackend, FakeScenario, SinkOp};
        let backend = FakeBackend::new(FakeScenario::default());
        let events = backend.sink().subscribe();
        self.0.lock().unwrap().push(std::thread::spawn(move || {
            for op in events {
                match op {
                    SinkOp::HeldKey { down: true, .. } => println!("XPC_TEST_KEY_DOWN"),
                    SinkOp::HeldKey { down: false, .. } => println!("XPC_TEST_KEY_UP"),
                    _ => {}
                }
            }
        }));
        Ok(Box::new(backend))
    }
}

impl Observers {
    pub(crate) fn finish(&self) {
        // Engine shutdown has dropped this connection's backends. Joining the
        // subscribed observers makes SESSION_CLOSED follow every actual key-up.
        for observer in self.0.lock().unwrap().drain(..) { observer.join().unwrap(); }
        println!("XPC_TEST_SESSION_CLOSED");
    }
}

pub(crate) fn state_dir() -> PathBuf {
    std::env::var_os("OMO_XPC_TEST_STATE_DIR")
        .map(PathBuf::from)
        .expect("the signed test harness must supply its private state directory")
}

pub(crate) async fn run_if_requested() -> bool {
    let Ok(service) = std::env::var("OMO_XPC_TEST_SERVICE") else {
        return false;
    };
    let mode = crate::cli::Cli::parse_from(["engine", "--xpc-agent", &service]).mode();
    let crate::cli::Mode::XpcAgent { name } = mode else {
        panic!("the fixture must select the real XPC agent mode");
    };
    assert!(state_dir().is_dir());
    crate::xpc::run(&name).await.expect("real XPC agent failed");
    true
}
