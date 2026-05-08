#!/usr/bin/env python3
"""Live-tail an OpenCode session for tmux team-mode worker panes.

OpenCode TUI's `attach --session <child>` enters a static subagent-detail
view (the `session.child.promptDisabled` mode) for any session with a
parentID. That view shows only the kickoff prompt and never streams.

This tailer subscribes to /event SSE and renders updates as plain text,
giving worker panes a live feed without depending on the TUI mode.

Usage: team-pane-live-tail.py <server-url> <session-id> [--no-clear] [--history N]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DIM = "\033[2m"
RST = "\033[0m"
CYAN = "\033[36m"
YEL = "\033[33m"
GRN = "\033[32m"
RED = "\033[31m"
MAG = "\033[35m"


def short(s: str, n: int = 100) -> str:
    s = s.replace("\n", " ⏎ ").replace("\r", "")
    return s if len(s) <= n else s[: n - 1] + "…"


def fmt_ts(ms: int | None) -> str:
    if not ms:
        return "        "
    return time.strftime("%H:%M:%S", time.localtime(ms / 1000))


def render_message(m: dict, role_tag: str | None = None) -> None:
    info = m.get("info", {})
    role = role_tag or info.get("role", "?").upper()
    ts = fmt_ts(info.get("time", {}).get("created"))
    parts = m.get("parts", [])
    for p in parts:
        ptype = p.get("type")
        if ptype == "text" and p.get("text"):
            colour = CYAN if role == "ASSISTANT" else GRN
            print(f"{ts} {colour}{role:9s}{RST} {short(p['text'])}")
        elif ptype == "tool":
            tool = p.get("tool", "?")
            state = p.get("state", {})
            status = state.get("status", "?")
            colour = YEL if status != "error" else RED
            print(f"{ts} {colour}TOOL     {RST} {tool} → {status}")
        elif ptype == "reasoning" and p.get("text"):
            print(f"{ts} {MAG}REASONING{RST} {short(p['text'], 80)}")


def fetch_history(url: str, session_id: str, n: int) -> int:
    try:
        with urllib.request.urlopen(f"{url}/session/{session_id}/message", timeout=5) as r:
            msgs = json.load(r)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"{RED}history fetch failed: {e}{RST}")
        return 0
    print(f"{DIM}── {len(msgs)} messages in session, showing last {min(n, len(msgs))} ──{RST}")
    for m in msgs[-n:]:
        render_message(m)
    return len(msgs)


def stream_events(url: str, session_id: str) -> None:
    print(f"{DIM}── live tail (Ctrl-C to exit) ──{RST}")
    seen_parts: set[str] = set()
    while True:
        try:
            req = urllib.request.Request(f"{url}/event", headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=None) as r:
                for raw in r:
                    line = raw.decode("utf-8", errors="replace").rstrip()
                    if not line.startswith("data: "):
                        continue
                    try:
                        ev = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    if not match_session(ev, session_id):
                        continue
                    handle_event(ev, seen_parts)
        except (urllib.error.URLError, ConnectionResetError, TimeoutError) as e:
            print(f"{DIM}stream interrupted ({e}); reconnecting in 2s{RST}")
            time.sleep(2)


def match_session(ev: dict, session_id: str) -> bool:
    props = ev.get("properties", {}) or {}
    candidates = (
        props.get("sessionID"),
        (props.get("info") or {}).get("sessionID"),
        (props.get("part") or {}).get("sessionID"),
        (props.get("info") or {}).get("id"),
    )
    return any(c == session_id for c in candidates if c)


def handle_event(ev: dict, seen: set[str]) -> None:
    etype = ev.get("type", "")
    props = ev.get("properties", {}) or {}
    ts = fmt_ts(int(time.time() * 1000))
    if etype == "message.part.updated":
        part = props.get("part", {}) or {}
        pid = part.get("id") or ""
        ptype = part.get("type")
        text = part.get("text") or ""
        key = f"{pid}:{len(text)}"
        if key in seen:
            return
        seen.add(key)
        if ptype == "text" and text:
            print(f"{ts} {CYAN}ASSISTANT{RST} {short(text)}")
        elif ptype == "tool":
            tool = part.get("tool", "?")
            status = (part.get("state") or {}).get("status", "?")
            colour = YEL if status != "error" else RED
            print(f"{ts} {colour}TOOL     {RST} {tool} → {status}")
        elif ptype == "reasoning" and text:
            print(f"{ts} {MAG}REASONING{RST} {short(text, 80)}")
    elif etype == "message.updated":
        info = props.get("info", {}) or {}
        role = info.get("role", "?").upper()
        finish = info.get("finish")
        if finish:
            print(f"{ts} {DIM}{role} finish={finish}{RST}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("session_id")
    p.add_argument("--no-clear", action="store_true")
    p.add_argument("--history", type=int, default=15)
    args = p.parse_args()

    if not args.no_clear:
        print("\033[2J\033[H", end="")
    print(f"{DIM}OmO team live-tail · {args.url} · {args.session_id}{RST}")
    fetch_history(args.url, args.session_id, args.history)
    stream_events(args.url, args.session_id)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f"\n{DIM}interrupted{RST}")
        sys.exit(130)
