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
import re
import sys
import time
import urllib.error
import urllib.request

DIM = "\033[2m"
RST = "\033[0m"
BOLD = "\033[1m"
CYAN = "\033[36m"
YEL = "\033[33m"
GRN = "\033[32m"
RED = "\033[31m"
MAG = "\033[35m"
BLU = "\033[34m"

# Per-pane accent colour ramp; deterministic by session id so each worker
# pane keeps its own colour across reconnects.
ACCENT_COLOURS = ["\033[38;5;39m", "\033[38;5;208m", "\033[38;5;41m", "\033[38;5;213m", "\033[38;5;220m", "\033[38;5;81m"]


def short(s: str, n: int = 100) -> str:
    s = s.replace("\n", " ⏎ ").replace("\r", "")
    return s if len(s) <= n else s[: n - 1] + "…"


def fmt_ts(ms: int | None) -> str:
    if not ms:
        return "        "
    return time.strftime("%H:%M:%S", time.localtime(ms / 1000))


def accent_for(session_id: str) -> str:
    return ACCENT_COLOURS[sum(ord(c) for c in session_id) % len(ACCENT_COLOURS)]


def summarize_peer_message(text: str) -> str | None:
    """Compress a verbose <peer_message ...>...</peer_message> blob into one line."""
    m = re.match(r'^\s*<peer_message\s+from="([^"]+)"[^>]*>(.*?)</peer_message>', text, re.DOTALL)
    if not m:
        return None
    sender = m.group(1)
    body = m.group(2).strip()
    return f"⇠ peer from {sender}: {short(body, 70)}"


class SessionState:
    """Holds session metadata + role lookup so SSE part-updates render with
    the correct USER/ASSISTANT label without re-fetching per event."""

    def __init__(self, url: str, session_id: str) -> None:
        self.url = url
        self.session_id = session_id
        self.member_name = "unknown"
        self.team_name = ""
        self.task_line = ""
        self.agent = ""
        self.model = ""
        self.role_by_message: dict[str, str] = {}

    def fetch(self) -> None:
        try:
            with urllib.request.urlopen(f"{self.url}/session/{self.session_id}", timeout=5) as r:
                info = json.load(r)
        except (urllib.error.URLError, json.JSONDecodeError):
            return
        title = info.get("title", "") or ""
        # Title shape: "Create team member <team>/<member> (@<agent> subagent)"
        m = re.match(r"Create team member ([^/]+)/([^\s(]+)\s*\(@([^\s)]+)", title)
        if m:
            self.team_name = m.group(1)
            self.member_name = m.group(2)
            self.agent = m.group(3)
        else:
            self.member_name = title[:48]


def render_banner(state: SessionState) -> None:
    accent = accent_for(state.session_id)
    print(f"{accent}{BOLD}▣ {state.member_name}{RST}", end="")
    if state.agent:
        print(f"  {DIM}{state.agent}{RST}", end="")
    if state.team_name:
        print(f"  {DIM}team={state.team_name}{RST}", end="")
    print()
    print(f"{DIM}session {state.session_id[:24]}…{RST}")


def render_message(m: dict, state: SessionState) -> None:
    info = m.get("info", {})
    role = info.get("role", "?").upper()
    msg_id = info.get("id")
    if msg_id:
        state.role_by_message[msg_id] = role
    ts = fmt_ts(info.get("time", {}).get("created"))
    parts = m.get("parts", [])
    for p in parts:
        ptype = p.get("type")
        if ptype == "text" and p.get("text"):
            text = p["text"]
            peer = summarize_peer_message(text)
            label, text = ("PEER", peer) if peer else (role, text)
            colour = CYAN if label == "ASSISTANT" else (BLU if label == "PEER" else GRN)
            print(f"{ts} {colour}{label:9s}{RST} {short(text)}")
        elif ptype == "tool":
            tool = p.get("tool", "?")
            status = (p.get("state") or {}).get("status", "?")
            colour = YEL if status != "error" else RED
            print(f"{ts} {colour}TOOL     {RST} {tool} → {status}")
        elif ptype == "reasoning" and p.get("text"):
            print(f"{ts} {MAG}REASONING{RST} {short(p['text'], 80)}")


_KICKOFF_META_PREFIXES = ("Team:", "TeamRunId:", "Member:")


def extract_task_line(kickoff_text: str) -> str:
    """Return the task description line from a team-kickoff prompt body.

    The kickoff begins with metadata headers (`Team:`, `TeamRunId:`, `Member:`)
    that the OpenCode TUI's static subagent-detail view also surfaces — so
    showing the first non-empty line of the prompt would just duplicate that
    static header. The real differentiator (and what users want at a glance)
    is the task body that follows the headers.
    """
    for line in kickoff_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(_KICKOFF_META_PREFIXES):
            continue
        if stripped.startswith("# ") or stripped.startswith("## "):
            # The kickoff template ends with `# Team Communication` boilerplate.
            return ""
        return stripped
    return ""


def fetch_history(state: SessionState, n: int) -> int:
    try:
        with urllib.request.urlopen(f"{state.url}/session/{state.session_id}/message", timeout=5) as r:
            msgs = json.load(r)
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"{RED}history fetch failed: {e}{RST}")
        return 0
    # Populate role lookup from full history so SSE renders correctly.
    for m in msgs:
        info = m.get("info", {})
        if info.get("id") and info.get("role"):
            state.role_by_message[info["id"]] = info["role"].upper()
    # Find the kickoff prompt's task body (skip metadata headers).
    for m in msgs:
        info = m.get("info", {})
        if info.get("role") != "user":
            continue
        for p in m.get("parts", []):
            if p.get("type") != "text" or not p.get("text"):
                continue
            text = p["text"]
            if "OMO_INTERNAL_INITIATOR" not in text:
                continue
            state.task_line = short(extract_task_line(text), 90)
            break
        if state.task_line:
            break
    if state.task_line:
        print(f"{DIM}task: {state.task_line}{RST}")
    print(f"{DIM}── {len(msgs)} messages, last {min(n, len(msgs))} ──{RST}")
    for m in msgs[-n:]:
        render_message(m, state)
    return len(msgs)


def stream_events(state: SessionState) -> None:
    print(f"{DIM}── live tail (Ctrl-C to exit) ──{RST}")
    seen_parts: dict[str, int] = {}
    while True:
        try:
            req = urllib.request.Request(f"{state.url}/event", headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=None) as r:
                for raw in r:
                    line = raw.decode("utf-8", errors="replace").rstrip()
                    if not line.startswith("data: "):
                        continue
                    try:
                        ev = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    if not match_session(ev, state.session_id):
                        continue
                    handle_event(ev, state, seen_parts)
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


def handle_event(ev: dict, state: SessionState, seen: dict[str, int]) -> None:
    etype = ev.get("type", "")
    props = ev.get("properties", {}) or {}
    ts = fmt_ts(int(time.time() * 1000))
    if etype == "message.updated":
        info = props.get("info", {}) or {}
        msg_id = info.get("id")
        role = info.get("role", "?").upper()
        if msg_id:
            state.role_by_message[msg_id] = role
        finish = info.get("finish")
        if finish:
            print(f"{ts} {DIM}{role} finish={finish}{RST}")
        return
    if etype != "message.part.updated":
        return
    part = props.get("part", {}) or {}
    pid = part.get("id") or ""
    parent_msg = part.get("messageID") or ""
    role = state.role_by_message.get(parent_msg, "ASSISTANT")
    ptype = part.get("type")
    text = part.get("text") or ""
    # Dedup growing-text streams: print only when the visible prefix grew.
    prev_len = seen.get(pid, 0)
    if ptype == "text" and text and len(text) > prev_len:
        seen[pid] = len(text)
        peer = summarize_peer_message(text)
        if peer:
            print(f"{ts} {BLU}PEER     {RST} {peer}")
        else:
            colour = CYAN if role == "ASSISTANT" else GRN
            print(f"{ts} {colour}{role:9s}{RST} {short(text)}")
    elif ptype == "tool":
        # Tool events fire on every status transition; only print on terminal states.
        status = (part.get("state") or {}).get("status", "?")
        prev_status = seen.get(f"{pid}:status")
        if status != prev_status:
            seen[f"{pid}:status"] = status  # type: ignore[assignment]
            colour = YEL if status != "error" else RED
            tool = part.get("tool", "?")
            print(f"{ts} {colour}TOOL     {RST} {tool} → {status}")
    elif ptype == "reasoning" and text and len(text) > prev_len:
        seen[pid] = len(text)
        print(f"{ts} {MAG}REASONING{RST} {short(text, 80)}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("session_id")
    p.add_argument("--no-clear", action="store_true")
    p.add_argument("--history", type=int, default=4)
    args = p.parse_args()

    if not args.no_clear:
        print("\033[2J\033[H", end="")
    state = SessionState(args.url, args.session_id)
    state.fetch()
    render_banner(state)
    fetch_history(state, args.history)
    stream_events(state)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f"\n{DIM}interrupted{RST}")
        sys.exit(130)
