#!/bin/sh
# SP-B row B-05c helper: the kernel premise of the root-agent host-death watch, measured with a
# stand-in process tree (no bunshin, no engine). Run as root: sudo -n /bin/sh probe-sp-b-root-watch.sh <uid> <gid>
# Tree: this script (subreaper) -> "agent" (root) -> "launcher" (pidfd on the agent, then uid drop)
# -> "engine" (the dropped user). The script SIGKILLs the agent and reports how long the launcher
# and the engine take to disappear. Prints one JSON line.
set -eu
[ "$(id -u)" = 0 ] || { echo "SP-B root-watch: must run as root" >&2; exit 2; }
[ $# -eq 2 ] || { echo "usage: probe-sp-b-root-watch.sh <uid> <gid>" >&2; exit 2; }
exec python3 - "$1" "$2" <<'PY'
import ctypes, json, os, select, signal, sys, time

libc = ctypes.CDLL(None, use_errno=True)
PR_SET_PDEATHSIG, PR_GET_PDEATHSIG, PR_SET_CHILD_SUBREAPER = 1, 2, 36
SYS_PIDFD_OPEN = 434
uid, gid = int(sys.argv[1]), int(sys.argv[2])

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
        pidfd = libc.syscall(SYS_PIDFD_OPEN, host, 0)
        watch = "pidfd" if pidfd >= 0 else "getppid_poll"
        libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
        before = pdeathsig()
        os.setgroups([])
        os.setresgid(gid, gid, gid)
        os.setresuid(uid, uid, uid)
        after = pdeathsig()
        libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
        engine = os.fork()
        if engine == 0:
            libc.prctl(PR_SET_PDEATHSIG, signal.SIGKILL, 0, 0, 0)
            signal.pause()
            os._exit(0)
        os.write(ready_w, (json.dumps({"launcher": os.getpid(), "engine": engine, "before": before,
                                       "after": after, "watch": watch, "uid": os.getuid()}) + "\n").encode())
        if pidfd >= 0:
            poller = select.poll()
            poller.register(pidfd, select.POLLIN)
            poller.poll()
        else:
            while os.getppid() == host:
                time.sleep(0.5)
        os.kill(engine, signal.SIGKILL)
        os._exit(137)
    signal.pause()
    os._exit(0)

os.close(ready_w)
readable, _, _ = select.select([ready_r], [], [], 10)
if not readable:
    os.kill(agent, signal.SIGKILL)
    print("SP-B root-watch: stand-in never became ready", file=sys.stderr)
    sys.exit(1)
ready = json.loads(os.read(ready_r, 4096).decode().splitlines()[0])
start = time.monotonic()
os.kill(agent, signal.SIGKILL)
gone = {}
signal.alarm(5)
while len(gone) < 3:
    pid, _ = os.waitpid(-1, 0)
    gone[pid] = round((time.monotonic() - start) * 1000, 1)
signal.alarm(0)
residual = [p for p in (agent, ready["launcher"], ready["engine"]) if os.path.exists(f"/proc/{p}")]
print(json.dumps({
    "uidAfterDrop": ready["uid"], "pdeathsigBeforeDrop": ready["before"], "pdeathsigAfterDrop": ready["after"],
    "hostWatch": ready["watch"], "launcherGoneMs": gone.get(ready["launcher"], -1),
    "engineGoneMs": gone.get(ready["engine"], -1), "residualPids": residual,
}))
PY
