use std::path::PathBuf;

use super::*;
use crate::responsible::ResponsibleProcess;

fn error_for(identity: Option<ResponsibleProcess>) -> DesktopError {
    denial_with_identity(
        TccPermission::ScreenRecording,
        "QA App".to_owned(),
        true,
        true,
        || identity,
    )
}

#[test]
fn self_responsible_identity_names_the_engine() {
    let identity = ResponsibleProcess {
        pid: 41,
        executable: PathBuf::from("/tmp/engine"),
        bundle_id: None,
    };
    let error = error_for(Some(identity));
    assert!(error.message.ends_with("(TCC identity: responsible=/tmp/engine, pid=41)"));
}

#[test]
fn app_responsible_identity_names_the_app_and_bundle() {
    let identity = ResponsibleProcess {
        pid: 42,
        executable: PathBuf::from("/Applications/QA.app/Contents/MacOS/QA"),
        bundle_id: Some("org.example.qa".to_owned()),
    };
    let error = error_for(Some(identity));
    assert!(error.message.ends_with(
        "(TCC identity: responsible=/Applications/QA.app/Contents/MacOS/QA bundle=org.example.qa, pid=42)"
    ));
}

#[test]
fn unresolved_identity_labels_the_engine_without_guessing() {
    let error = error_for(None);
    let engine = std::env::current_exe().unwrap();
    assert!(error.message.ends_with(&format!(
        "(TCC identity: unresolved (engine executable={}))",
        engine.display()
    )));
}
