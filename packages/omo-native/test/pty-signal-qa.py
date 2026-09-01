#!/usr/bin/env python3
"""Real-surface QA: SIGTERM the omo launcher on a pty and watch the engine.

Usage: pty-signal-qa.py <launcher-js> <transcript-path> [agent-dir]

Boots the real launcher chain on a real pty (so the engine renders its TUI exactly as it does for a
user) inside a session that OUTLIVES the launcher, then sends SIGTERM to the LAUNCHER only.

The session layout matters. If the launcher itself were the session leader, killing it would make
the kernel SIGHUP the foreground process group, and the engine would die from that instead of from
anything the launcher did - the bug would be invisible. So a "shell" process owns the session and
stays alive, exactly like the user's real terminal:

    shell (session leader, owns the pty)
      └── launcher  (node bin/omo.js)          <- the only process this harness signals
            └── engine (senpi interactive TUI)

Reported:
  ENGINE_PID / ENGINE_PPID_AFTER / ENGINE_ALIVE_AFTER / ENGINE_EXITED_AFTER_SECONDS / ORPHANED

Pre-fix chain: the launcher blocks in spawnSync, dies instantly on SIGTERM, and the engine is
reparented to pid 1 and keeps running -> ORPHANED: True, RESULT: FAIL.
Post-fix chain: the launcher forwards SIGTERM, the engine runs its own graceful shutdown, and
nothing is left behind -> ORPHANED: False, RESULT: PASS.

The harness only ever signals processes it started itself.
"""
import fcntl
import json
import os
import pty
import select
import signal
import subprocess
import sys
import termios
import time

LAUNCHER = sys.argv[1]
TRANSCRIPT = sys.argv[2]
AGENT_DIR = sys.argv[3] if len(sys.argv) > 3 else "/tmp/omo-pty-signal-qa-agent"

BOOT_SECONDS = float(os.environ.get("QA_BOOT_SECONDS", "15"))
GRACE_SECONDS = float(os.environ.get("QA_GRACE_SECONDS", "20"))
TRUST_MARKER = b"Trust project folder?"

env = dict(os.environ)
for stale in ("OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"):
    env.pop(stale, None)
env.update(
    {
        "SENPI_CODING_AGENT_DIR": AGENT_DIR,
        "PI_OFFLINE": "1",
        "TERM": "xterm-256color",
        "NO_COLOR": "1",
    }
)


def children_of(pid):
    listed = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True)
    return [int(line) for line in listed.stdout.split() if line.strip()]


def descendants(root):
    """Every descendant of a pid, deepest last.

    Matching on the cmdline is not available for the engine: it renames its own process title to
    the brand ("OmO") under node, so the descendant relationship is the reliable identity. Each
    level of the chain spawns exactly one child, so the deepest descendant is the engine.
    """
    found = []
    level = [root]
    seen = {root}
    while level:
        nxt = []
        for pid in level:
            for child in children_of(pid):
                if child in seen:
                    continue
                seen.add(child)
                nxt.append(child)
        found.extend(nxt)
        level = nxt
    return found


def process_info(pid):
    listed = subprocess.run(
        ["ps", "-o", "ppid=,stat=,args=", "-p", str(pid)], capture_output=True, text=True
    )
    line = listed.stdout.strip()
    if not line:
        return None
    ppid, stat, args = line.split(None, 2)
    return {"ppid": int(ppid), "stat": stat, "args": args}


master, slave = pty.openpty()
report_read, report_write = os.pipe()

shell_pid = os.fork()
if shell_pid == 0:
    # ---- "shell": session leader owning the pty; it outlives the launcher ----
    os.close(master)
    os.close(report_read)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    launcher_pid = os.fork()
    if launcher_pid == 0:
        os.close(report_write)
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        os.execvpe("node", ["node", LAUNCHER], env)

    os.write(report_write, (json.dumps({"launcher": launcher_pid}) + "\n").encode())
    # Reap the launcher and hand its real wait status back to the harness.
    _, status = os.waitpid(launcher_pid, 0)
    os.write(report_write, (json.dumps({"status": status}) + "\n").encode())
    os.close(report_write)
    # Stay alive so the session (and therefore the engine's controlling terminal) survives the
    # launcher's death; the harness kills this process at the end.
    time.sleep(3600)
    os._exit(0)

os.close(slave)
os.close(report_write)
reports = os.fdopen(report_read)
launcher_pid = json.loads(reports.readline())["launcher"]

output = bytearray()
trusted = False
boot_deadline = time.time() + BOOT_SECONDS
chain = []
while time.time() < boot_deadline:
    ready, _, _ = select.select([master], [], [], 0.2)
    if ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            chunk = b""
        if chunk:
            output += chunk
    if not trusted and TRUST_MARKER in bytes(output):
        time.sleep(0.5)
        os.write(master, b"\r")
        trusted = True
    found = descendants(launcher_pid)
    if len(found) > len(chain):
        chain = found

# Under a bun global install the chain is three deep (node launcher -> bun launcher -> engine), so
# the engine is the DEEPEST descendant and every level in between has to disappear too.
engine_pid = chain[-1] if chain else None
before = process_info(engine_pid) if engine_pid else None
print(f"TRUST_PROMPT_ANSWERED: {trusted}", flush=True)
print(f"SHELL_PID: {shell_pid}", flush=True)
print(f"LAUNCHER_PID: {launcher_pid}", flush=True)
print(f"LAUNCHER_DESCENDANTS: {chain}", flush=True)
print(f"ENGINE_PID: {engine_pid}", flush=True)
print(f"ENGINE_PPID_BEFORE: {before['ppid'] if before else None}", flush=True)


def cleanup(extra_pids=()):
    for pid in [*extra_pids, shell_pid]:
        if pid is None:
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


if engine_pid is None or before is None:
    with open(TRANSCRIPT, "w") as fh:
        fh.write(output.decode("utf8", "replace"))
    print("RESULT: engine never booted; QA inconclusive", flush=True)
    cleanup([launcher_pid])
    sys.exit(2)

# The launcher only. Signaling the process group would reach the engine directly, which is exactly
# the delivery path this QA must not rely on.
os.kill(launcher_pid, signal.SIGTERM)
signaled_at = time.time()

engine_gone_at = None
shutdown_output = bytearray()
deadline = signaled_at + GRACE_SECONDS
while time.time() < deadline:
    ready, _, _ = select.select([master], [], [], 0.2)
    if ready:
        try:
            chunk = os.read(master, 65536)
        except OSError:
            chunk = b""
        if chunk:
            output += chunk
            shutdown_output += chunk
    if engine_gone_at is None and all(process_info(pid) is None for pid in chain):
        engine_gone_at = time.time()
        # Keep draining briefly: the last writes of the engine's terminal restore can still be in
        # the pty buffer when the process itself is already gone.
        deadline = min(deadline, engine_gone_at + 1.0)

survivors = {pid: process_info(pid) for pid in chain}
survivors = {pid: info for pid, info in survivors.items() if info is not None}
after = survivors.get(engine_pid)
alive_after = len(survivors) > 0
orphaned = any(info["ppid"] == 1 for info in survivors.values())

launcher_status = None
reports_line = None
ready, _, _ = select.select([report_read], [], [], 1.0)
if ready:
    reports_line = reports.readline()
if reports_line:
    launcher_status = json.loads(reports_line)["status"]

with open(TRANSCRIPT, "w") as fh:
    fh.write(output.decode("utf8", "replace"))

print(f"SURVIVING_PIDS_AFTER: {sorted(survivors)}", flush=True)
print(f"ENGINE_ALIVE_AFTER: {alive_after}", flush=True)
print(f"ENGINE_PPID_AFTER: {after['ppid'] if after else None}", flush=True)
print(
    f"ENGINE_EXITED_AFTER_SECONDS: {round(engine_gone_at - signaled_at, 2) if engine_gone_at else None}",
    flush=True,
)
# The engine's graceful signal path restores the terminal on its way out (cursor back on, bracketed
# paste off). A killed or orphaned engine never writes these, so their presence is what proves the
# engine ran ITS OWN shutdown rather than merely disappearing.
restored = b"\x1b[?25h" in bytes(shutdown_output) and b"\x1b[?2004l" in bytes(shutdown_output)
print(f"ORPHANED: {orphaned}", flush=True)
print(f"ENGINE_TERMINAL_RESTORED: {restored}", flush=True)
if launcher_status is None:
    print("LAUNCHER_STATUS: still-running", flush=True)
elif os.WIFEXITED(launcher_status):
    print(f"LAUNCHER_STATUS: exit={os.WEXITSTATUS(launcher_status)}", flush=True)
elif os.WIFSIGNALED(launcher_status):
    print(f"LAUNCHER_STATUS: signal={os.WTERMSIG(launcher_status)}", flush=True)
print(f"TRANSCRIPT: {TRANSCRIPT}", flush=True)
if alive_after:
    verdict = f"FAIL {len(survivors)} process(es) survive launcher SIGTERM: {sorted(survivors)}"
elif not restored:
    verdict = "FAIL engine vanished without running its own graceful shutdown"
else:
    verdict = "PASS engine ran its own graceful shutdown and left nothing behind"
print(f"RESULT: {verdict}", flush=True)

# Never leave anything behind, whichever way the assertion went: this harness owns these pids.
cleanup(sorted(survivors))
sys.exit(0 if verdict.startswith("PASS") else 1)
