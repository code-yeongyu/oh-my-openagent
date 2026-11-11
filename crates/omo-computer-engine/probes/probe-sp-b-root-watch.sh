#!/bin/sh
# SP-B rows B-05c / B-05e helper: the host-death watch of a root agent's launcher, measured with a
# stand-in process tree (no bunshin, no engine). Run as root:
#   sudo -n /bin/sh probe-sp-b-root-watch.sh <uid> <gid> <pidfd|pdeathsig|none>
# Tree: this script (subreaper) -> "agent" (root) -> "launcher" (opens a pidfd on the agent, then drops
# to <uid>) -> "engine" (the dropped user). The script SIGKILLs the agent and reports how and how fast
# the launcher and the engine end. Each mode leaves exactly ONE watch live in the launcher:
#   pidfd     - PDEATHSIG stays cleared by the uid drop; only the pidfd POLLIN path can end the launcher
#               (it SIGKILLs the engine and exits 137).
#   pdeathsig - PDEATHSIG re-armed after the drop and no pidfd poll; the kernel SIGKILLs the launcher.
#   none      - neither watch (negative control): the launcher must still be alive after 2 s.
# Prints one JSON line. Exit 2: usage or not root. Exit 3: python3 missing.
set -eu
[ $# -eq 3 ] || { echo "usage: probe-sp-b-root-watch.sh <uid> <gid> <pidfd|pdeathsig|none>" >&2; exit 2; }
case "$3" in pidfd|pdeathsig|none) ;; *) echo "SP-B root-watch: unknown mode $3" >&2; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo "SP-B root-watch: must run as root" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "SP-B precondition missing: python3 not found" >&2; exit 3; }
exec python3 - "$1" "$2" "$3" <<'PY'
import ctypes, json, os, select, signal, sys, time

libc = ctypes.CDLL(None, use_errno=True)
PR_SET_PDEATHSIG, PR_GET_PDEATHSIG, PR_SET_CHILD_SUBREAPER = 1, 2, 36
SYS_PIDFD_OPEN = 434
WINDOW_MS = 2000
uid, gid, mode = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]

def pidfd_open(pid):
    return libc.syscall(SYS_PIDFD_OPEN, pid, 0)

def pdeathsig():
    value = ctypes.c_int(-1)
    libc.prctl(PR_GET_PDEATHSIG, ctypes.byref(value), 0, 0, 0)
    return value.value

libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
ready_r, ready_w = os.pipe()
agent = os.fork()
if agent == 0:
    os.close(ready_r)
    launcher = os.fork()
    if launcher == 0:
        host = os.getppid()
        host_fd = pidfd_open(host)
        watch = "pidfd" if host_fd >= 0 else "getppid_poll"
        libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
        before = pdeathsig()
        os.setgroups([])
        os.setresgid(gid, gid, gid)
        os.setresuid(uid, uid, uid)
        after = pdeathsig()
        if mode == "pdeathsig":
            libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
        me = os.getpid()
        eng_r, eng_w = os.pipe()
        engine = os.fork()
        if engine == 0:
            # Engine-ready handshake: arm the death signal on the launcher, then prove the launcher is
            # still the parent; only then report ready. A launcher that died first is caught here.
            os.close(eng_r)
            libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
            if os.getppid() != me:
                os._exit(1)
            os.write(eng_w, b"r")
            os.close(eng_w)
            signal.pause()
            os._exit(0)
        os.close(eng_w)
        if os.read(eng_r, 1) != b"r":
            os.kill(engine, signal.SIGKILL)
            os._exit(1)
        os.write(ready_w, (json.dumps({"launcher": me, "engine": engine, "before": before,
                                       "after": after, "watch": watch, "uid": os.getuid()}) + "\n").encode())
        if mode == "pidfd" and host_fd >= 0:
            poller = select.poll()
            poller.register(host_fd, select.POLLIN)
            poller.poll()
            os.kill(engine, signal.SIGKILL)
            os._exit(137)
        signal.pause()
        os._exit(0)
    signal.pause()
    os._exit(0)

os.close(ready_w)
readable, _, _ = select.select([ready_r], [], [], 10)
if not readable:
    os.kill(agent, signal.SIGKILL)
    print("SP-B root-watch: stand-in never became ready", file=sys.stderr)
    sys.exit(1)
ready = json.loads(os.read(ready_r, 4096).decode().splitlines()[0])
launcher, engine = ready["launcher"], ready["engine"]
fds = {pidfd_open(launcher): "launcher", pidfd_open(engine): "engine"}
poller = select.poll()
for fd in fds:
    poller.register(fd, select.POLLIN)
start = time.monotonic()
os.kill(agent, signal.SIGKILL)
gone = {}
while len(gone) < 2:
    left_ms = WINDOW_MS - (time.monotonic() - start) * 1000
    if left_ms <= 0:
        break
    for fd, _ in poller.poll(left_ms):
        name = fds[fd]
        if name not in gone:
            gone[name] = round((time.monotonic() - start) * 1000, 1)
            poller.unregister(fd)
# Anything still alive after the window is the probe's to clean up; it is reported, never hidden.
killed_by_probe = []
for pid, name in ((launcher, "launcher"), (engine, "engine")):
    if name not in gone:
        killed_by_probe.append(name)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
# Reap exactly the three stand-in pids (the shell's heredoc writer is also a child of this process).
statuses = {}
signal.alarm(5)
while not all(p in statuses for p in (agent, launcher, engine)):
    pid, status = os.waitpid(-1, 0)
    statuses[pid] = status
signal.alarm(0)
st = statuses.get(launcher, 0)
if "launcher" in killed_by_probe:
    ended = "killed by probe after the window"
elif os.WIFSIGNALED(st):
    ended = f"signal {os.WTERMSIG(st)}"
else:
    ended = f"exit {os.WEXITSTATUS(st)}"
residual = [p for p in (agent, launcher, engine) if os.path.exists(f"/proc/{p}")]
print(json.dumps({
    "mode": mode, "uidAfterDrop": ready["uid"], "pdeathsigBeforeDrop": ready["before"],
    "pdeathsigAfterDrop": ready["after"], "hostWatch": ready["watch"], "launcherEnded": ended,
    "launcherGoneMs": gone.get("launcher", -1), "engineGoneMs": gone.get("engine", -1),
    "killedByProbe": killed_by_probe, "residualPids": residual,
}))
PY
