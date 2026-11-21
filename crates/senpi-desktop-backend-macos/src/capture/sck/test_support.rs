//! Scoped real helper programs, isolated on the worker's owning test thread.

use std::cell::RefCell;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

thread_local! {
    static PROGRAM: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

pub(super) fn program() -> Option<PathBuf> {
    PROGRAM.with_borrow(Clone::clone)
}

pub(crate) struct ProgramGuard;

impl ProgramGuard {
    pub(crate) fn new(program: PathBuf) -> Self {
        super::HELPER_CLIENT.with_borrow_mut(|slot| *slot = None);
        PROGRAM.with_borrow_mut(|slot| {
            assert!(slot.is_none(), "helper program guards must not overlap");
            *slot = Some(program);
        });
        Self
    }
}

impl Drop for ProgramGuard {
    fn drop(&mut self) {
        super::HELPER_CLIENT.with_borrow_mut(|slot| *slot = None);
        PROGRAM.with_borrow_mut(|slot| *slot = None);
    }
}

/// A fake helper: an executable Python script at `path`.
pub(crate) fn fake_helper(dir: &tempfile::TempDir, body: &str) -> PathBuf {
    let path = dir.path().join("helper.py");
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

pub(super) const PY_PREAMBLE: &str = r#"#!/usr/bin/env python3
import json, struct, sys

def header(value):
    sys.stdout.buffer.write((json.dumps(value) + "\n").encode())
    sys.stdout.buffer.flush()

def pixels(width, height, bgra):
    sys.stdout.buffer.write(bytes(bgra) * (width * height))
    sys.stdout.buffer.flush()

def read_request():
    # The engine warms the worker with a ping first; answer it like the helper.
    while True:
        request = json.loads(sys.stdin.buffer.readline().decode())
        if request.get('kind') != 'ping':
            return request
        header({'kind': 'ready'})
"#;
