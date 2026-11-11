#!/usr/bin/env python3
"""SP-W KWin helper: bind org_kde_plasma_window_management, then ask KWin to activate the window owned by
<target pid> (org_kde_plasma_window.set_state(active, active), the request a taskbar sends).
Prints one JSON object: whether the global bound, the windows seen, and which pid holds the active state
before and 2 s after the request. KWin advertises the global only to an executable that a desktop file names
in X-KDE-Wayland-Interfaces, so the caller runs this under such a desktop file.
usage: kde-pwm.py <target pid>"""
import json, os, subprocess, sys, tempfile, time

proto_dir = tempfile.mkdtemp(prefix="spw-proto-")
# one argument of the protocol is named "is", a Python keyword: rename it in a private copy before generating
xml = os.path.join(proto_dir, "plasma-window-management.xml")
with open("/usr/share/plasma-wayland-protocols/plasma-window-management.xml") as src, open(xml, "w") as dst:
    dst.write(src.read().replace('name="is"', 'name="is_"'))
pkg = os.path.join(proto_dir, "spwproto")  # generated modules import each other relatively: give them a parent
os.makedirs(pkg)
open(os.path.join(pkg, "__init__.py"), "w").close()
subprocess.run([sys.executable, "-m", "pywayland.scanner", "-i", "/usr/share/wayland/wayland.xml", xml, "-o", pkg],
               check=True, capture_output=True)
sys.path.insert(0, proto_dir)
from pywayland.client import Display  # noqa: E402
from spwproto.plasma_window_management import OrgKdePlasmaWindowManagement  # noqa: E402

ACTIVE = 1
target = int(sys.argv[1])
display = Display()
display.connect()
registry = display.get_registry()
state = {"wm": None, "windows": {}}


def on_global(reg, name, iface, version):
    if iface == "org_kde_plasma_window_management":
        state["wm"] = reg.bind(name, OrgKdePlasmaWindowManagement, min(version, 16))


registry.dispatcher["global"] = on_global
display.roundtrip()
if state["wm"] is None:
    print(json.dumps({"bound": False}), flush=True)
    os._exit(0)


def track(uuid):
    w = state["wm"].get_window_by_uuid(uuid)
    rec = {"uuid": uuid, "pid": None, "active": False, "proxy": w}
    state["windows"][uuid] = rec
    w.dispatcher["pid_changed"] = lambda _w, pid: rec.__setitem__("pid", pid)
    w.dispatcher["state_changed"] = lambda _w, flags: rec.__setitem__("active", bool(flags & ACTIVE))


state["wm"].dispatcher["window_with_uuid"] = lambda _wm, _id, uuid: track(uuid)
for _ in range(4):
    display.roundtrip()


def active_pid():
    return next((w["pid"] for w in state["windows"].values() if w["active"]), None)


before = active_pid()
tw = next((w for w in state["windows"].values() if w["pid"] == target), None)
if tw is not None:
    tw["proxy"].set_state(ACTIVE, ACTIVE)
    display.flush()
deadline = time.monotonic() + 2
while time.monotonic() < deadline:
    display.roundtrip()
    time.sleep(0.05)
print(json.dumps({"bound": True, "windows": sorted(w["pid"] or 0 for w in state["windows"].values()),
                  "target_found": tw is not None, "active_before": before, "active_after": active_pid(), "target": target}),
      flush=True)
os._exit(0)  # pywayland's interpreter-exit teardown segfaults after a disconnect-free run; the result is already out
