use super::{
    handoff::{Handoff, posix_spawnattr_set_registered_ports_np},
    wait::Event,
};
use crate::native::Endpoint;
use std::{ffi::CString, os::unix::process::ExitStatusExt, process::ExitStatus, ptr};

struct Attributes(libc::posix_spawnattr_t);
impl Attributes {
    fn new(port: u32) -> Self {
        let mut raw = ptr::null_mut();
        // SAFETY: initialize one writable spawn attribute object.
        assert_eq!(unsafe { libc::posix_spawnattr_init(&mut raw) }, 0);
        let mut attr = Self(raw);
        // SAFETY: valid attribute object; the child inherits a send right to
        // `port` as its first registered port, and its bootstrap stays intact.
        let mut ports = [port];
        assert_eq!(
            unsafe {
                posix_spawnattr_set_registered_ports_np(&mut attr.0, ports.as_mut_ptr(), 1)
            },
            0
        );
        // SAFETY: suspend before any child code so NOTE_EXIT is registered first.
        assert_eq!(
            unsafe {
                libc::posix_spawnattr_setflags(
                    &mut attr.0,
                    libc::POSIX_SPAWN_START_SUSPENDED as i16,
                )
            },
            0
        );
        attr
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: exactly one initialized attribute object.
        assert_eq!(unsafe { libc::posix_spawnattr_destroy(&mut self.0) }, 0);
    }
}

pub(super) struct Child {
    pid: Option<libc::pid_t>,
    exited: Event,
}

impl Child {
    pub(super) fn spawn(endpoint: &Endpoint, role: &str) -> Self {
        let handoff = Handoff::new();
        let attr = Attributes::new(handoff.port);
        let exe = CString::new(
            std::env::current_exe()
                .unwrap()
                .as_os_str()
                .as_encoded_bytes(),
        )
        .unwrap();
        let args = [
            exe,
            CString::new("--exact").unwrap(),
            CString::new("crash_tests::fixture").unwrap(),
            CString::new("--nocapture").unwrap(),
        ];
        let mut argv: Vec<_> = args.iter().map(|arg| arg.as_ptr().cast_mut()).collect();
        argv.push(ptr::null_mut());
        let mut vars: Vec<_> = std::env::vars_os()
            .filter(|(key, _)| key != "O2_CRASH_ROLE")
            .map(|(key, value)| {
                CString::new([key.as_encoded_bytes(), b"=", value.as_encoded_bytes()].concat())
                    .unwrap()
            })
            .collect();
        vars.push(CString::new(format!("O2_CRASH_ROLE={role}")).unwrap());
        let mut env: Vec<_> = vars.iter().map(|entry| entry.as_ptr().cast_mut()).collect();
        env.push(ptr::null_mut());
        let mut pid = 0;
        // SAFETY: all argument/environment strings outlive spawn, arrays terminate
        // in NULL, attributes are initialized, and pid is writable.
        assert_eq!(
            unsafe {
                libc::posix_spawn(
                    &mut pid,
                    args[0].as_ptr(),
                    ptr::null(),
                    &attr.0,
                    argv.as_ptr(),
                    env.as_ptr(),
                )
            },
            0
        );
        let child = Self {
            pid: Some(pid),
            exited: Event::subscribe(pid as usize, libc::EVFILT_PROC, libc::NOTE_EXIT),
        };
        // SAFETY: this is our unreaped, suspended child, so its PID cannot be reused.
        assert_eq!(unsafe { libc::kill(pid, libc::SIGCONT) }, 0);
        handoff.reply(endpoint);
        child
    }

    pub(super) fn kill(&mut self) -> ExitStatus {
        // SAFETY: unreaped owned child; no destructor/graceful disconnect executes.
        assert_eq!(unsafe { libc::kill(self.pid.unwrap(), libc::SIGKILL) }, 0);
        self.wait()
    }

    pub(super) fn wait(&mut self) -> ExitStatus {
        self.exited.wait();
        let pid = self.pid.take().unwrap();
        let mut status = 0;
        // SAFETY: NOTE_EXIT has fired; reap exactly this owned child into status.
        assert_eq!(unsafe { libc::waitpid(pid, &mut status, 0) }, pid);
        println!("R3_CHILD_CLEANUP pid={pid} reaped=true");
        ExitStatus::from_raw(status)
    }
}
impl Drop for Child {
    fn drop(&mut self) {
        if self.pid.is_some() {
            self.kill();
        }
    }
}
