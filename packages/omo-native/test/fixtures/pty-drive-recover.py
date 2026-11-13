#!/usr/bin/env python3
"""Drives sync-recover-phrase-pty.fixture.ts on a real pty like a person typing a recovery phrase.

argv: <fixture.ts> <stdout file> <stderr file> <transcript file>. PTY_TYPE holds the entries to type, separated
by '|'; when they run out the driver presses Ctrl+C. Exits with the child's code (90 on a stuck prompt).
"""
import os
import pty
import select
import sys
import time

fixture, out_path, err_path, transcript_path = sys.argv[1:5]
entries = [e for e in os.environ.get("PTY_TYPE", "").split("|") if e]
pid, fd = pty.fork()
if pid == 0:
    os.dup2(os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 1)
    os.dup2(os.open(err_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 2)
    os.execvp("bun", ["bun", fixture])

screen = b""
asked = 0
status = None
deadline = time.monotonic() + float(os.environ.get("PTY_DRIVE_SECONDS", "50"))
while time.monotonic() < deadline:
    ready, _, _ = select.select([fd], [], [], 0.5)
    if ready:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            chunk = b""
        if not chunk:
            _, code = os.waitpid(pid, 0)
            status = os.waitstatus_to_exitcode(code)
            break
        screen += chunk
        with open(transcript_path, "wb") as handle:
            handle.write(screen)
        prompts = screen.decode("utf-8", "replace").count("Type your 24-word recovery phrase")
        while asked < prompts:
            os.write(fd, (entries[asked].encode() + b"\r") if asked < len(entries) else b"\x03")
            asked += 1
    done, code = os.waitpid(pid, os.WNOHANG)
    if done:
        status = os.waitstatus_to_exitcode(code)
        break
if status is None:
    os.kill(pid, 9)
    sys.exit(90)
sys.exit(status)
