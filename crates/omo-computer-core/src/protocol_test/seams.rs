//! Design row C17 with amendment A9: exactly nine seams, the fake-only ones refused
//! unless the backend is the fake.

use crate::env::{check_launch_env, SeamRefusal, ENV_SEAMS};

#[test]
fn engine_env_seams_enumerated() {
    let names: Vec<&str> = ENV_SEAMS.iter().map(|seam| seam.name).collect();
    assert_eq!(
        names,
        [
            "OMO_COMPUTER_BACKEND",
            "OMO_COMPUTER_FAKE_CLOCK",
            "OMO_COMPUTER_FAKE_STOP_PATH",
            "OMO_COMPUTER_FAKE_SCENARIO",
            "OMO_COMPUTER_RUNTIME_DIR",
            "OMO_COMPUTER_DISABLE_SKYLIGHT",
            "OMO_COMPUTER_UPDATE_SCHEMA",
            "OMO_COMPUTER_CONFORMANCE_DIR",
            "OMO_COMPUTER_BUILD_SHA",
        ]
    );
    let fake_only: Vec<&str> = ENV_SEAMS
        .iter()
        .filter(|seam| seam.fake_only)
        .map(|seam| seam.name)
        .collect();
    assert_eq!(
        fake_only,
        [
            "OMO_COMPUTER_FAKE_CLOCK",
            "OMO_COMPUTER_FAKE_STOP_PATH",
            "OMO_COMPUTER_FAKE_SCENARIO",
            "OMO_COMPUTER_RUNTIME_DIR"
        ]
    );
}

#[test]
fn fake_only_seams_are_refused_with_a_real_backend() {
    for seam in [
        "OMO_COMPUTER_FAKE_SCENARIO",
        "OMO_COMPUTER_RUNTIME_DIR",
        "OMO_COMPUTER_FAKE_CLOCK",
        "OMO_COMPUTER_FAKE_STOP_PATH",
    ] {
        let refused = check_launch_env([("OMO_COMPUTER_BACKEND", "macos"), (seam, "1")]);
        assert_eq!(
            refused,
            Err(SeamRefusal::FakeOnlySeamWithRealBackend {
                name: seam.to_owned()
            })
        );
        let unset_backend = check_launch_env([(seam, "1")]);
        assert_eq!(
            unset_backend,
            Err(SeamRefusal::FakeOnlySeamWithRealBackend {
                name: seam.to_owned()
            })
        );
        let admitted = check_launch_env([("OMO_COMPUTER_BACKEND", "fake"), (seam, "1")])
            .expect("fake admits it");
        assert_eq!(admitted.len(), 2);
    }
}

#[test]
fn an_unknown_seam_is_refused_and_other_variables_are_ignored() {
    assert_eq!(
        check_launch_env([("OMO_COMPUTER_OPERATION_TIMEOUT_MS", "5")]),
        Err(SeamRefusal::UnknownSeam {
            name: "OMO_COMPUTER_OPERATION_TIMEOUT_MS".to_owned()
        })
    );
    assert_eq!(
        check_launch_env([("HOME", "/home/user"), ("PATH", "/bin")]),
        Ok(Vec::new())
    );
}
