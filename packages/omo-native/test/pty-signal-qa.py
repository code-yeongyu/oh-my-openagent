#!/usr/bin/env python3
"""Drive the real launcher on a PTY, SIGTERM its PID, and prove graceful engine exit.

Usage: pty-signal-qa.py <launcher-js> <transcript-path> [agent-dir]

A separate session leader owns the PTY and outlives the launcher. The kernel therefore cannot
hide an orphaning bug by sending SIGHUP when the launcher exits. With execve, the launcher PID
becomes the engine PID; legitimate engine children are not mistaken for the engine.
QA_EXPECT_EXECVE=0 permits the older spawn shape for explicit fallback comparisons.
"""
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
from pathlib import Path
from typing import TypedDict

LAUNCHER = str(Path(sys.argv[1]).resolve())
TRANSCRIPT = Path(sys.argv[2]).resolve()
TRANSCRIPT.parent.mkdir(parents=True, exist_ok=True)
ROOT = Path(tempfile.mkdtemp(prefix="pty-signal-", dir=TRANSCRIPT.parent))
AGENT_DIR = Path(sys.argv[3]).resolve() if len(sys.argv) > 3 else ROOT / "agent"
HOME = ROOT / "home"
PROJECT = ROOT / "project"
for directory in (AGENT_DIR, HOME, PROJECT):
    directory.mkdir(parents=True, exist_ok=True)
if len(sys.argv) <= 3:
    (AGENT_DIR / "settings.json").write_text(json.dumps({"changelogSeen": True, "lastChangelogVersion": "999.0.0"}))
    (AGENT_DIR / "trust.json").write_text(json.dumps({str(PROJECT): True}))
    marker = AGENT_DIR / "omo-senpi/omo-native/onboarding-completed"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text('{"completedAt":"1970-01-01T00:00:00.000Z","version":1}')

BOOT_SECONDS = float(os.environ.get("QA_BOOT_SECONDS", "90"))
GRACE_SECONDS = float(os.environ.get("QA_GRACE_SECONDS", "20"))
EXPECT_EXECVE = os.environ.get("QA_EXPECT_EXECVE", "1") != "0"
env = {key: value for key, value in os.environ.items()
       if not key.startswith(("OMO_", "SENPI_", "PI_", "NODE_OPTIONS", "NODE_COMPILE_CACHE"))}
env.update({
    "HOME": str(HOME), "USERPROFILE": str(HOME),
    "XDG_CONFIG_HOME": str(ROOT / "config"), "XDG_DATA_HOME": str(ROOT / "data"),
    "XDG_CACHE_HOME": str(ROOT / "cache"), "XDG_STATE_HOME": str(ROOT / "state"),
    "SENPI_CODING_AGENT_DIR": str(AGENT_DIR), "OMO_CODING_AGENT_DIR": str(AGENT_DIR),
    "PI_OFFLINE": "1", "OMO_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1",
    "TERM": "xterm-256color", "COLORTERM": "truecolor",
})
if "OMO_RUNTIME" in os.environ:
    env["OMO_RUNTIME"] = os.environ["OMO_RUNTIME"]


class ProcessInfo(TypedDict):
    ppid: int
    stat: str
    args: str


def children_of(pid: int) -> list[int]:
    listed = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True, check=False)
    return [int(line) for line in listed.stdout.split()]


def descendants(root: int) -> list[int]:
    found: list[int] = []
    level = [root]
    seen = {root}
    while level:
        following = []
        for pid in level:
            for child in children_of(pid):
                if child not in seen:
                    seen.add(child)
                    following.append(child)
        found.extend(following)
        level = following
    return found


def process_info(pid: int) -> ProcessInfo | None:
    listed = subprocess.run(["ps", "-o", "ppid=,stat=,args=", "-p", str(pid)],
                            capture_output=True, text=True, check=False)
    if not listed.stdout.strip():
        return None
    ppid, stat, args = listed.stdout.strip().split(None, 2)
    return {"ppid": int(ppid), "stat": stat, "args": args}


def is_engine(pid: int) -> bool:
    info = process_info(pid)
    return info is not None and (
        info["args"].split()[0] in ("OmO", "omo", "senpi")
        or "/senpi/dist/cli.js" in info["args"]
        or "/senpi/dist/bundle/cli.js" in info["args"]
    )


master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))
report_read, report_write = os.pipe()
shell_pid = os.fork()
if shell_pid == 0:
    os.close(master)
    os.close(report_read)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    launcher_pid = os.fork()
    if launcher_pid == 0:
        os.close(report_write)
        os.chdir(PROJECT)
        for fd in (0, 1, 2):
            os.dup2(slave, fd)
        os.execvpe("node", ["node", LAUNCHER], env)
    os.write(report_write, (json.dumps({"launcher": launcher_pid}) + "\n").encode())
    _, status = os.waitpid(launcher_pid, 0)
    os.write(report_write, (json.dumps({"status": status}) + "\n").encode())
    os.close(report_write)
    signal.pause()
    os._exit(0)

os.close(slave)
os.close(report_write)
reports = os.fdopen(report_read)
launcher_pid = json.loads(reports.readline())["launcher"]
output = bytearray()
shutdown_output = bytearray()
engine_pid = None
chain: list[int] = []
launcher_status = None
trusted = False
passed = False
try:
    deadline = time.monotonic() + BOOT_SECONDS
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master, report_read], [], [], max(0, deadline - time.monotonic()))
        if report_read in ready:
            report = reports.readline()
            if report:
                launcher_status = json.loads(report)["status"]
            break
        if master in ready:
            output += os.read(master, 65536)
            if not trusted and b"Trust project folder?" in output:
                os.write(master, b"\r")
                trusted = True
            # DECSET 2026 frame-end proves the TUI painted, not just enabled its input mode.
            # Check identity on that event; startup helpers are not engine candidates.
            if b"\x1b[?2004h" in output and b"\x1b[?2026l" in output:
                chain = descendants(launcher_pid)
                engine_pid = next((pid for pid in [launcher_pid, *chain] if is_engine(pid)), None)
                if engine_pid is not None:
                    break

    print(f"TRUST_PROMPT_ANSWERED: {trusted}", flush=True)
    print(f"SHELL_PID: {shell_pid}", flush=True)
    print(f"LAUNCHER_PID: {launcher_pid}", flush=True)
    print(f"LAUNCHER_DESCENDANTS: {chain}", flush=True)
    print(f"ENGINE_PID: {engine_pid}", flush=True)
    print(f"ENGINE_PID == LAUNCHER_PID: {engine_pid == launcher_pid}", flush=True)
    print(f"PROCESS_TREE: {json.dumps({pid: process_info(pid) for pid in [launcher_pid, *chain]})}", flush=True)
    Path(str(TRANSCRIPT) + ".before.ansi").write_bytes(output)
    if engine_pid is None or (EXPECT_EXECVE and engine_pid != launcher_pid):
        print("RESULT: FAIL engine never booted or launcher PID was not replaced", flush=True)
    else:
        owned = [launcher_pid, *chain]
        os.kill(launcher_pid, signal.SIGTERM)
        deadline = time.monotonic() + GRACE_SECONDS
        # The shell's waitpid report is the completion signal; register its pipe before SIGTERM.
        while time.monotonic() < deadline:
            readers = [master] if launcher_status is not None else [master, report_read]
            ready, _, _ = select.select(readers, [], [], max(0, deadline - time.monotonic()))
            if master in ready:
                chunk = os.read(master, 65536)
                output += chunk
                shutdown_output += chunk
            if report_read in ready:
                report = reports.readline()
                if report:
                    launcher_status = json.loads(report)["status"]
                    # Child-reaping grace is itself the acceptance criterion, not a boot sleep.
                    deadline = min(deadline, time.monotonic() + 2)
            if not ready:
                break
        survivors = {pid: info for pid in owned if (info := process_info(pid)) is not None}
        restored = b"\x1b[?25h" in shutdown_output and b"\x1b[?2004l" in shutdown_output
        print(f"SURVIVING_PIDS_AFTER: {list(survivors)}", flush=True)
        print(f"ENGINE_ALIVE_AFTER: {engine_pid in survivors}", flush=True)
        print(f"ORPHANED: {any(info['ppid'] == 1 for info in survivors.values())}", flush=True)
        print(f"ENGINE_TERMINAL_RESTORED: {restored}", flush=True)
        print(f"LAUNCHER_STATUS: {launcher_status}", flush=True)
        passed = not survivors and restored and launcher_status is not None
        print(f"RESULT: {'PASS' if passed else 'FAIL'} engine shutdown and process cleanup", flush=True)
finally:
    TRANSCRIPT.write_bytes(output)
    owned = list(dict.fromkeys([*chain, *descendants(launcher_pid), launcher_pid, shell_pid]))
    for pid in reversed(owned):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    os.waitpid(shell_pid, 0)
    reports.close()
    os.close(master)
    shutil.rmtree(ROOT)
    receipt = subprocess.run(["ps", "-o", "pid=,ppid=,stat=,args=", "-p", ",".join(map(str, owned))],
                             capture_output=True, text=True, check=False).stdout.strip()
    print(f"CLEANUP_PS: {receipt or 'no owned pids'}", flush=True)
    print(f"CLEANUP: removed {ROOT}; closed PTY/pipes; reaped shell {shell_pid}", flush=True)
    if receipt:
        passed = False
sys.exit(0 if passed else 1)
