#!/usr/bin/env python3
"""SP-W portal client. Runs INSIDE a probe container session. Prints one JSON object on stdout.

Subcommands
  iface <Name>                        org.freedesktop.portal.<Name>: version, absent (with the enumerated list) or error
  screencast [--restore-file F] [--save-file F] [--timeout S]
  remote [--screencast] [--clipboard] [--restore-file F] [--save-file F] [--timeout S]
         [--eis-helper MODE] [--second-eis] [--hold-seconds S]

Token files follow the engine's X10 (a) policy: one file, mode 0600, opened with O_NOFOLLOW.
"""
import argparse, json, os, subprocess, sys, time, uuid

import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

from iface_probe import probe_interface

DEST = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"


def out(obj):
    print(json.dumps(obj, sort_keys=True), flush=True)


bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
sender = bus.get_unique_name()[1:].replace(".", "_")


def token():
    return "spw" + uuid.uuid4().hex[:12]


def call(iface, method, args, sig, timeout_ms=30000, fdlist=False):
    if fdlist:
        return bus.call_with_unix_fd_list_sync(DEST, PATH, iface, method, GLib.Variant(sig, args), None,
                                               Gio.DBusCallFlags.NONE, timeout_ms, None, None)
    return bus.call_sync(DEST, PATH, iface, method, GLib.Variant(sig, args) if sig else None, None,
                         Gio.DBusCallFlags.NONE, timeout_ms, None)


def introspect_frontend():
    return bus.call_sync(DEST, PATH, "org.freedesktop.DBus.Introspectable", "Introspect", None,
                         GLib.VariantType("(s)"), Gio.DBusCallFlags.NONE, 10000, None).unpack()[0]


def read_version(full_name):
    return bus.call_sync(DEST, PATH, "org.freedesktop.DBus.Properties", "Get",
                         GLib.Variant("(ss)", (full_name, "version")), GLib.VariantType("(v)"),
                         Gio.DBusCallFlags.NONE, 10000, None).unpack()[0]


def iface(name):
    """{"version"}, {"absent", "interfaces"} or {"error"} for org.freedesktop.portal.<name> (see iface_probe)."""
    return probe_interface(name, introspect_frontend, read_version)


def gate(rec, name, res):
    """Records the presence check of the session's main interface; returns False when the run must stop here."""
    rec["iface_name"] = "org.freedesktop.portal." + name
    if "error" in res:
        rec["result"], rec["iface_error"] = "interface_error", res["error"]
        return False
    if res.get("absent"):
        rec["result"], rec["interfaces_enumerated"] = "interface_absent", len(res["interfaces"])
        rec["interfaces"] = res["interfaces"]
        return False
    rec["iface_version"] = res["version"]
    return True


def request(iface, method, build_args, timeout_s):
    """Calls a portal method that answers through a Request object; returns (code, results)."""
    tok = token()
    req_path = f"/org/freedesktop/portal/desktop/request/{sender}/{tok}"
    loop = GLib.MainLoop()
    box = {}

    def on_resp(_c, _s, _p, _i, _sig, params):
        box["code"], box["results"] = params.unpack()
        loop.quit()

    sub = bus.signal_subscribe(DEST, "org.freedesktop.portal.Request", "Response", req_path, None,
                               Gio.DBusSignalFlags.NO_MATCH_RULE, on_resp)
    # NO_MATCH_RULE needs an explicit match so the bus routes the signal to us
    bus.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "AddMatch",
                  GLib.Variant("(s)", (f"type='signal',interface='org.freedesktop.portal.Request',path='{req_path}'",)),
                  None, Gio.DBusCallFlags.NONE, 5000, None)
    args, sig = build_args(tok)
    call(iface, method, args, sig)
    GLib.timeout_add(int(timeout_s * 1000), loop.quit)
    loop.run()
    bus.signal_unsubscribe(sub)
    if "code" not in box:
        try:  # close the pending request so the dialog goes away
            bus.call_sync(DEST, req_path, "org.freedesktop.portal.Request", "Close", None, None,
                          Gio.DBusCallFlags.NONE, 5000, None)
        except GLib.Error:
            pass
        return None, {}
    return box["code"], box["results"]


def read_token(path):
    if not path or not os.path.exists(path):
        return None
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    st = os.fstat(fd)
    data = os.read(fd, 4096).decode().strip()
    os.close(fd)
    return {"token": data, "mode": oct(st.st_mode & 0o777)}


def save_token(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    os.fchmod(fd, 0o600)
    os.write(fd, value.encode())
    os.close(fd)


def create_session(iface, timeout_s):
    code, res = request(iface, "CreateSession",
                        lambda t: (({"handle_token": GLib.Variant("s", t),
                                     "session_handle_token": GLib.Variant("s", token())},), "(a{sv})"), timeout_s)
    if code != 0:
        raise SystemExit(out({"stage": "CreateSession", "code": code}) or 1)
    return res["session_handle"]


def screencast(a):
    rec = {}
    if not gate(rec, "ScreenCast", iface("ScreenCast")):
        return out(rec)
    restore = read_token(a.restore_file)
    rec["restore_token_supplied"] = bool(restore)
    if restore:
        rec["restore_file_mode"] = restore["mode"]
    s = create_session("org.freedesktop.portal.ScreenCast", a.timeout)
    opts = {"types": GLib.Variant("u", 1), "multiple": GLib.Variant("b", False), "persist_mode": GLib.Variant("u", 2)}
    if restore:
        opts["restore_token"] = GLib.Variant("s", restore["token"])
    code, _ = request("org.freedesktop.portal.ScreenCast", "SelectSources",
                      lambda t: ((s, {**opts, "handle_token": GLib.Variant("s", t)}), "(oa{sv})"), a.timeout)
    rec["select_code"] = code
    t0 = time.monotonic()
    code, res = request("org.freedesktop.portal.ScreenCast", "Start",
                        lambda t: ((s, "", {"handle_token": GLib.Variant("s", t)}), "(osa{sv})"), a.timeout)
    rec["start_code"] = code
    rec["start_ms"] = int((time.monotonic() - t0) * 1000)
    rec["streams"] = len(res.get("streams", [])) if res else 0
    rec["restore_token_returned"] = bool(res and res.get("restore_token"))
    rec["persist_mode_returned"] = res.get("persist_mode") if res else None
    if a.save_file and res and res.get("restore_token"):
        save_token(a.save_file, res["restore_token"])
    rec["result"] = "started" if code == 0 else ("timeout" if code is None else f"code_{code}")
    out(rec)


def eis_helper(mode, fd, hold_seconds):
    return subprocess.Popen(["/opt/spw/ei-probe", mode, str(fd), str(hold_seconds)], pass_fds=(fd,),
                            stdout=subprocess.PIPE, text=True)


def remote(a):
    rec = {}
    if not gate(rec, "RemoteDesktop", iface("RemoteDesktop")):
        return out(rec)
    clip = iface("Clipboard") if a.clipboard else {}
    rec["clipboard_iface_version"] = clip.get("version")
    restore = read_token(a.restore_file)
    rec["restore_token_supplied"] = bool(restore)
    s = create_session("org.freedesktop.portal.RemoteDesktop", a.timeout)
    if a.clipboard:
        if "error" in clip:
            rec["clipboard_request"] = "interface_error:" + clip["error"]
        elif clip.get("absent"):
            rec["clipboard_request"] = "interface_absent"
        else:
            try:
                call("org.freedesktop.portal.Clipboard", "RequestClipboard", (s, {}), "(oa{sv})")
                rec["clipboard_request"] = "accepted_call"
            except GLib.Error as e:
                rec["clipboard_request"] = "error:" + e.message
    opts = {"types": GLib.Variant("u", 3), "persist_mode": GLib.Variant("u", 2)}
    if restore:
        opts["restore_token"] = GLib.Variant("s", restore["token"])
    code, _ = request("org.freedesktop.portal.RemoteDesktop", "SelectDevices",
                      lambda t: ((s, {**opts, "handle_token": GLib.Variant("s", t)}), "(oa{sv})"), a.timeout)
    rec["select_devices_code"] = code
    if a.screencast:
        sc = {"types": GLib.Variant("u", 1), "multiple": GLib.Variant("b", True)}
        code, _ = request("org.freedesktop.portal.ScreenCast", "SelectSources",
                          lambda t: ((s, {**sc, "handle_token": GLib.Variant("s", t)}), "(oa{sv})"), a.timeout)
        rec["select_sources_code"] = code
    t0 = time.monotonic()
    code, res = request("org.freedesktop.portal.RemoteDesktop", "Start",
                        lambda t: ((s, "", {"handle_token": GLib.Variant("s", t)}), "(osa{sv})"), a.timeout)
    rec["start_code"] = code
    rec["start_ms"] = int((time.monotonic() - t0) * 1000)
    rec["devices"] = res.get("devices") if res else None
    rec["streams"] = len(res.get("streams", [])) if res else 0
    rec["clipboard_enabled"] = res.get("clipboard_enabled") if res else None
    rec["restore_token_returned"] = bool(res and res.get("restore_token"))
    if a.save_file and res and res.get("restore_token"):
        save_token(a.save_file, res["restore_token"])
    rec["result"] = "started" if code == 0 else ("timeout" if code is None else f"code_{code}")
    if code != 0:
        return out(rec)
    if a.eis_helper:
        try:
            v, fds = call("org.freedesktop.portal.RemoteDesktop", "ConnectToEIS", (s, {}), "(oa{sv})", fdlist=True)
            fd = fds.get(v.unpack()[0])
            rec["eis_connect_1"] = "ok"
        except GLib.Error as e:
            rec["eis_connect_1"] = "error:" + e.message
            return out(rec)
        if a.second_eis:
            try:
                v2, fds2 = call("org.freedesktop.portal.RemoteDesktop", "ConnectToEIS", (s, {}), "(oa{sv})", fdlist=True)
                fd2 = fds2.get(v2.unpack()[0])
                rec["eis_connect_2"] = "ok"
                p2 = eis_helper("regions", fd2, 3)
                os.close(fd2)
                rec["eis_2_report"] = [json.loads(l) for l in p2.stdout if l.strip()]
                p2.wait()
            except GLib.Error as e:
                rec["eis_connect_2"] = "error:" + e.message
        p = eis_helper(a.eis_helper, fd, a.hold_seconds)
        os.close(fd)  # the helper is now the only holder of the EIS socket (the "engine")
        rec["eis_helper_pid"] = p.pid
        out({"partial": rec})
        # stream the helper's lines to our stdout so the caller can act on HELD before the helper exits
        for line in p.stdout:
            if line.strip():
                print(json.dumps({"helper": json.loads(line)}), flush=True)
        rec["eis_helper_exit"] = p.wait()
    out(rec)


def mutter_key(keysym):
    """GNOME only, setup step: press and release one keysym through Mutter's own RemoteDesktop API (no dialog).
    Used to leave the overview gnome-shell opens at startup, so a new window can take keyboard focus."""
    md, mp = "org.gnome.Mutter.RemoteDesktop", "/org/gnome/Mutter/RemoteDesktop"
    s = bus.call_sync(md, mp, md, "CreateSession", None, GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    si = md + ".Session"
    bus.call_sync(md, s, si, "Start", None, None, Gio.DBusCallFlags.NONE, 5000, None)
    for down in (True, False):
        bus.call_sync(md, s, si, "NotifyKeyboardKeysym", GLib.Variant("(ub)", (keysym, down)), None, Gio.DBusCallFlags.NONE, 5000, None)
    time.sleep(0.3)
    bus.call_sync(md, s, si, "Stop", None, None, Gio.DBusCallFlags.NONE, 5000, None)
    active = bus.call_sync("org.gnome.Shell", "/org/gnome/Shell", "org.freedesktop.DBus.Properties", "Get",
                           GLib.Variant("(ss)", ("org.gnome.Shell", "OverviewActive")), GLib.VariantType("(v)"),
                           Gio.DBusCallFlags.NONE, 5000, None).unpack()[0]
    out({"mutter_key": keysym, "overview_active_after": active})


ap = argparse.ArgumentParser()
sp = ap.add_subparsers(dest="cmd", required=True)
p = sp.add_parser("iface"); p.add_argument("name")
p = sp.add_parser("mutter-key"); p.add_argument("keysym", type=int)
for name in ("screencast", "remote"):
    p = sp.add_parser(name)
    p.add_argument("--restore-file"); p.add_argument("--save-file"); p.add_argument("--timeout", type=float, default=15)
    if name == "remote":
        p.add_argument("--screencast", action="store_true"); p.add_argument("--clipboard", action="store_true")
        p.add_argument("--eis-helper"); p.add_argument("--second-eis", action="store_true")
        p.add_argument("--hold-seconds", type=float, default=30)
a = ap.parse_args()
if a.cmd == "iface":
    res = iface(a.name)
    out({"iface": "org.freedesktop.portal." + a.name, **res,
         "interfaces_enumerated": len(res["interfaces"]) if "interfaces" in res else None})
elif a.cmd == "mutter-key":
    mutter_key(a.keysym)
elif a.cmd == "screencast":
    screencast(a)
else:
    remote(a)
