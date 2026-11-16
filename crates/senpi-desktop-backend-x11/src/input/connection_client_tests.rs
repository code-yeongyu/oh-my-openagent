//! Which X-Resource pids the background-input check trusts: the X server
//! reports pids in its own pid namespace, so a window's pid is read from this
//! engine's `/proc` only when the server sees this engine under its own pid.

use super::connection_client::trusted_pid;

const ENGINE: u32 = 4100;

#[test]
fn a_pid_is_trusted_when_the_server_sees_this_engine_under_its_own_pid() {
    // Given / When / Then
    assert_eq!(trusted_pid(Some(5200), Some(ENGINE), ENGINE), Ok(5200));
}

#[test]
fn a_server_in_another_pid_namespace_makes_the_window_pid_unknown() {
    // Given: the engine runs in a container with the host X socket mounted; the server sees it as pid 77.
    // When
    let result = trusted_pid(Some(5200), Some(77), ENGINE);
    // Then: pid 5200 may name an unrelated process here, so it is not used.
    assert!(result.is_err(), "{result:?}");
}

#[test]
fn a_server_that_knows_no_pid_for_this_engine_makes_the_window_pid_unknown() {
    // Given / When / Then
    assert!(trusted_pid(Some(5200), None, ENGINE).is_err());
    assert!(trusted_pid(None, Some(ENGINE), ENGINE).is_err());
}
