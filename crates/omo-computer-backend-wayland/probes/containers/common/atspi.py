#!/usr/bin/env python3
"""SP-W AT-SPI helper. Runs INSIDE a probe container session.

  atspi.py list                 print {"apps": [...]} - the application names in the AT-SPI registry
  atspi.py approve <seconds>    act as the person at the portal dialog: select the first screen,
                                tick a "remember / allow restore" check box, press the accept button.
                                Prints one JSON line per action and a final {"approved": bool}.
Used only for the FIRST grant of a portal permission; restore legs never run it.
"""
import json, re, sys, time

import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

ACCEPT = {"share", "allow", "ok", "start", "accept", "continue", "share screen", "share desktop"}
REMEMBER = ("remember", "restore", "allow restoring", "allow restore", "allow remote interaction", "allow remote control")
PORTAL_APPS = ("portal", "xdg-desktop-portal")


def emit(obj):
    print(json.dumps(obj, sort_keys=True), flush=True)


def apps():
    d = Atspi.get_desktop(0)
    return [d.get_child_at_index(i) for i in range(d.get_child_count())]


def walk(node, depth=0):
    if node is None or depth > 40:
        return
    yield node
    try:
        n = node.get_child_count()
    except Exception:
        return
    for i in range(n):
        try:
            yield from walk(node.get_child_at_index(i), depth + 1)
        except Exception:
            continue


def role(n):
    try:
        return n.get_role_name()
    except Exception:
        return ""


def name(n):
    try:
        return (n.get_name() or "").strip()
    except Exception:
        return ""


def states(n):
    try:
        return n.get_state_set()
    except Exception:
        return None


def has_action(n):
    try:
        act = n.get_action_iface()
        return act is not None and act.get_n_actions() > 0
    except Exception:
        return False


def do_action(n, preferred=("click", "press", "activate", "toggle")):
    try:
        act = n.get_action_iface()
    except Exception:
        act = None
    if act is None:
        return None
    names = [act.get_action_name(i) for i in range(act.get_n_actions())]
    for p in preferred:
        if p in names:
            act.do_action(names.index(p))
            return p
    if names:
        act.do_action(0)
        return names[0]
    return None


def approve(seconds):
    deadline = time.monotonic() + seconds
    dumped = set()
    picked = set()
    while time.monotonic() < deadline:
        for app in apps():
            an = name(app).lower()
            if not any(p in an for p in PORTAL_APPS):
                continue
            nodes = list(walk(app))
            if an not in dumped:
                dumped.add(an)
                emit({"dialog_app": an, "tree": [[role(n), name(n)] for n in nodes if name(n) or role(n) in ("push button", "check box", "list item", "table row")][:160]})
            # a screen chooser: toggle buttons or list rows; choose every screen once (a single-choice chooser
            # keeps the last), so a multiple-source request is granted all outputs
            screens = [n for n in nodes if has_action(n) and (role(n) in ("toggle button", "list item", "table row", "radio button")
                       or (role(n) == "button" and re.match(r"^(Virtual-\d+|HEADLESS-\d+|Meta-\d+)$", name(n))))]
            if an not in picked:
                picked.add(an)
                for s in screens:
                    st = states(s)
                    if st is not None and not (st.contains(Atspi.StateType.CHECKED) or st.contains(Atspi.StateType.SELECTED)):
                        emit({"action": do_action(s, ("click", "toggle", "press", "activate", "select")), "on": [role(s), name(s)]})
                        time.sleep(0.3)
            for n in nodes:
                if role(n) in ("check box", "switch") and any(r in name(n).lower().replace("_", "") for r in REMEMBER):
                    st = states(n)
                    if st is not None and not st.contains(Atspi.StateType.CHECKED):
                        emit({"action": do_action(n, ("click", "toggle", "press", "activate")), "on": [role(n), name(n)]})
                        time.sleep(0.2)
            for n in nodes:
                if role(n) in ("push button", "button") and name(n).lower().replace("_", "").replace("&", "") in ACCEPT:
                    st = states(n)
                    if st is not None and st.contains(Atspi.StateType.SENSITIVE):
                        emit({"action": do_action(n), "on": [role(n), name(n)]})
                        emit({"approved": True})
                        return 0
        time.sleep(0.3)
    emit({"approved": False})
    return 1


if __name__ == "__main__":
    if sys.argv[1] == "list":
        emit({"apps": sorted(name(a) for a in apps())})
    elif sys.argv[1] == "approve":
        sys.exit(approve(float(sys.argv[2])))
    else:
        sys.exit(2)
