#!/usr/bin/env python3
"""Drives sync-enable-phrase-pty.fixture.ts on a real pty, like a person at a terminal.

argv: <fixture.ts> <stdout file> <stderr file> <transcript file>. The child's stdout and stderr go to files, its
controlling terminal is the pty. The driver answers the prompts it sees on the pty and records the transcript.
Exit 0 when the child exited 0, else the child's code (or 90 on a stuck prompt).
"""
import os
import pty
import re
import select
import sys
import time

fixture, out_path, err_path, transcript_path = sys.argv[1:5]
pid, fd = pty.fork()
if pid == 0:
    out = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    err = os.open(err_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.dup2(out, 1)
    os.dup2(err, 2)
    os.execvp("bun", ["bun", fixture])

screen = b""
answered = set()
deadline = time.monotonic() + float(os.environ.get("PTY_DRIVE_SECONDS", "50"))
status = None
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
        text = screen.decode("utf-8", "replace")
        for prompt in ("Press Enter to show the words", "press Enter."):
            if text.count(prompt) > len([a for a in answered if a.startswith(prompt)]):
                answered.add(f"{prompt}#{text.count(prompt)}")
                os.write(fd, b"\r")
        asked = list(re.finditer(r"Type words ([0-9, ]+) of your recovery phrase", text))
        if asked and f"ask#{len(asked)}" not in answered:
            answered.add(f"ask#{len(asked)}")
            words = re.findall(r"^ ?([0-9]{1,2})\. ([a-z]+)\r*$", text, re.M)
            shown = {int(n): w for n, w in words}
            reply = " ".join(shown.get(int(p), "") for p in asked[-1].group(1).split(", "))
            os.write(fd, reply.encode() + b"\r")
    done, code = os.waitpid(pid, os.WNOHANG)
    if done:
        status = os.waitstatus_to_exitcode(code)
        break
with open(transcript_path, "wb") as handle:
    handle.write(screen)
if status is None:
    os.kill(pid, 9)
    sys.exit(90)
sys.exit(status)
