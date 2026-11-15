#!/usr/bin/env python3
"""Runs tty-signal-restore.fixture.ts on a real pty and ends its phrase ceremony from outside.

argv: <fixture.ts> <mode> <action> <report file>. <action> is a signal name (SIGHUP, SIGTERM, SIGINT) sent to the
child's pid, or ctrl-c typed on the terminal. The driver owns the pty and keeps the terminal side open, so the
terminal's mode is still readable after the child is gone. Prints one JSON object; exit 0 unless the driver
itself got stuck (90).
"""
import fcntl
import json
import os
import pty
import select
import signal
import sys
import termios
import time

fixture, mode, action, report = sys.argv[1:5]
PROMPT = b"Press Enter to show the words"
BOUND = float(os.environ.get("PTY_SIGNAL_SECONDS", "30"))

master, slave = pty.openpty()
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    for fd in (0, 1, 2):
        os.dup2(slave, fd)
    os.execvp("bun", ["bun", fixture, mode, report])


def raw(attrs):
    return not (attrs[3] & termios.ECHO) and not (attrs[3] & termios.ICANON)


screen = b""
after = b""
acted = False
raw_during = None
status = None
deadline = time.monotonic() + BOUND
while time.monotonic() < deadline and status is None:
    ready, _, _ = select.select([master], [], [], 0.5)
    if ready:
        try:
            chunk = os.read(master, 4096)
        except OSError:
            chunk = b""
        screen += chunk
        if acted:
            after += chunk
        if not acted and PROMPT in screen:
            raw_during = raw(termios.tcgetattr(slave))
            acted = True
            if action == "ctrl-c":
                os.write(master, b"\x03")
            else:
                os.kill(pid, getattr(signal, action))
    done, code = os.waitpid(pid, os.WNOHANG)
    if done:
        status = code
if status is None:
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    sys.exit(90)
while True:
    ready, _, _ = select.select([master], [], [], 0)
    if not ready:
        break
    try:
        chunk = os.read(master, 4096)
    except OSError:
        break
    if not chunk:
        break
    after += chunk
attrs = termios.tcgetattr(slave)
os.close(master)
os.close(slave)
print(json.dumps({
    "raw_during": raw_during,
    "echo_after": bool(attrs[3] & termios.ECHO),
    "canonical_after": bool(attrs[3] & termios.ICANON),
    "left_alternate_screen": b"\x1b[?1049l" in after,
    "signal": signal.Signals(os.WTERMSIG(status)).name if os.WIFSIGNALED(status) else None,
    "exit_code": os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
}))
