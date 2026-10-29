use std::sync::Arc;

use senpi_desktop_core::key_reroute::audit::AuditSink;
use senpi_desktop_core::protocol_results::{EngineLog, LogLevel};
use serde::Serialize;

use crate::worker::Worker;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Record<'a> {
    timestamp: String,
    session_id: &'a str,
    run_id: &'a str,
    target: &'a str,
    #[serde(flatten)]
    event: senpi_desktop_core::key_reroute::audit::AuditEvent,
}

impl Worker {
    pub(crate) fn reroute_audit_sink(&self, target: &str) -> AuditSink {
        let path = self
            .options
            .as_ref()
            .and_then(|options| options.audit_path.clone());
        let session_id = self.session_id.clone();
        let run_id = self.run_id.clone();
        let target = target.to_owned();
        let log = Arc::clone(&self.background_log);
        Arc::new(move |event| {
            let record = Record {
                timestamp: super::rfc3339_ms(super::unix_now_ms()),
                session_id: &session_id,
                run_id: &run_id,
                target: &target,
                event,
            };
            if let Some(path) = &path {
                super::writer::append(path, &record);
            }
            match serde_json::to_string(&record) {
                Ok(message) => log(EngineLog {
                    level: LogLevel::Info,
                    message,
                }),
                Err(error) => super::warn(format_args!("reroute audit encoding failed: {error}")),
            }
        })
    }
}
