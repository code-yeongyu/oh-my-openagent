#!/usr/bin/env python3
"""Live-tail an OpenCode session for tmux team-mode worker panes.

OpenCode TUI's `attach --session <child>` enters a static subagent-detail
view (the `session.child.promptDisabled` mode) for any session with a
parentID. That view shows only the kickoff prompt and never streams.

This tailer subscribes to /event SSE and renders updates as plain text in
the companion live-tail tmux window while the main team window keeps attach.

Usage: team-pane-live-tail.py <server-url> <session-id> [--no-clear] [--history N] [--insecure]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
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

    def __init__(self, url: str, session_id: str, insecure: bool = False) -> None:
        # OmO's tmuxMgr.getServerUrl() emits the URL with a trailing slash,
        # so naive `f"{url}/session/..."` concatenation produces `//session`
        # which OpenCode rejects with an empty body. Normalise once.
        self.url = url.rstrip("/")
        self.session_id = session_id
        self.member_name = "unknown"
        self.team_name = ""
        self.task_line = ""
        self.agent = ""
        self.model = ""
        self.role_by_message: dict[str, str] = {}
        self.ssl_context = ssl._create_unverified_context() if insecure else ssl.create_default_context()
        self.footer: StatusFooter | None = None

    def auth_headers(self) -> dict[str, str]:
        password = os.environ.get("OPENCODE_SERVER_PASSWORD")
        if not password:
            return {}
        username = os.environ.get("OPENCODE_SERVER_USERNAME") or "opencode"
        token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
        return {"Authorization": f"Basic {token}"}

    def open_url(
        self,
        url: str,
        timeout: float | None = 5,
        headers: dict[str, str] | None = None,
    ):
        merged_headers = {**self.auth_headers(), **(headers or {})}
        request = urllib.request.Request(url, headers=merged_headers) if merged_headers else url
        return urllib.request.urlopen(request, timeout=timeout, context=self.ssl_context)

    def fetch(self) -> None:
        try:
            with self.open_url(f"{self.url}/session/{self.session_id}", timeout=5) as r:
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


class StatusFooter:
    """Daemon thread that prints a status line at the last terminal row every 10s."""

    _INTERVAL = 10.0

    def __init__(self, url: str) -> None:
        self._url = url
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._connected = False
        self._last_error: str | None = None
        self._events_seen: int = 0
        self._last_event_ts: float | None = None
        self._capable = self._detect_capability()
        self._thread: threading.Thread | None = None

    def _detect_capability(self) -> bool:
        term = os.environ.get("TERM", "")
        if term in ("dumb", ""):
            return False
        try:
            result = subprocess.run(["tput", "sc"], capture_output=True)
            return result.returncode == 0
        except (OSError, FileNotFoundError):
            return False

    def note_event(self) -> None:
        with self._lock:
            self._events_seen += 1
            self._last_event_ts = time.time()
            self._connected = True
            self._last_error = None

    def note_disconnect(self, err: str) -> None:
        with self._lock:
            self._connected = False
            self._last_error = err

    def note_reconnect(self, url: str) -> None:
        with self._lock:
            self._url = url
            self._connected = True
            self._last_error = None

    def _render(self) -> str:
        with self._lock:
            if self._connected:
                last_str = (
                    time.strftime("%H:%M:%S", time.localtime(self._last_event_ts))
                    if self._last_event_ts is not None
                    else "--:--:--"
                )
                text = f"[connected → {self._url} | events: {self._events_seen} | last: {last_str}]"
            else:
                err_str = f" ({self._last_error})" if self._last_error else ""
                text = f"[disconnected ✗{err_str}]"
        return f"\x1b[s\x1b[999;1H\x1b[2K{DIM}{text}{RST}\x1b[u"

    def _run(self) -> None:
        while not self._stop_event.wait(self._INTERVAL):
            try:
                sys.stdout.write(self._render())
                sys.stdout.flush()
            except (OSError, ValueError):
                break

    def start(self) -> None:
        if not self._capable:
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        if self._capable:
            try:
                sys.stdout.write("\n")
                sys.stdout.flush()
            except (OSError, ValueError):
                pass


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
        with state.open_url(f"{state.url}/session/{state.session_id}/message", timeout=5) as r:
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


class _PollOpts:
    """Options for poll_session_messages()."""

    def __init__(
        self,
        poll_interval_seconds: float = 1.0,
        max_reconnect_wallclock_seconds: int = 90,
    ) -> None:
        self.poll_interval_seconds = poll_interval_seconds
        self.max_reconnect_wallclock_seconds = max_reconnect_wallclock_seconds


_BACKOFF_SEQUENCE = (2, 5, 10, 15, 30)


def poll_session_messages(state: SessionState, opts: _PollOpts | None = None) -> int:
    """Tail the session by polling /session/<id>/message at a steady cadence.

    Replaces the prior `/event` SSE flow. opencode 1.14.48's SSE endpoint
    accepts subscribers but stops delivering events shortly after the
    initial `server.connected` handshake (verified via 20s curl: 0 data
    frames received while the bus published >140 message.part.delta
    events). The opencode TUI itself uses /session/<id>/message polling
    for the same reason — we match that strategy here.
    """
    if opts is None:
        opts = _PollOpts()
    interval = max(0.25, opts.poll_interval_seconds)
    print(f"{DIM}── live tail (polling every {interval:.1f}s, Ctrl-C to exit) ──{RST}")
    seen_parts: dict[str, int] = {}
    seen_status: dict[str, str] = {}
    seen_finish: set[str] = set()
    failure_wallclock: float = 0.0
    attempt: int = 0

    while True:
        try:
            with state.open_url(
                f"{state.url}/session/{state.session_id}/message",
                timeout=10,
            ) as r:
                msgs = json.load(r)
            # Reset failure tracking on a successful poll.
            failure_wallclock = 0.0
            attempt = 0
            if state.footer is not None:
                state.footer.note_reconnect(state.url)
            rendered_any = _render_polled_messages(msgs, state, seen_parts, seen_status, seen_finish)
            if rendered_any and state.footer is not None:
                state.footer.note_event()
            time.sleep(interval)
        except (TimeoutError, socket.timeout):
            if state.footer is not None:
                state.footer.note_disconnect("poll timeout — retrying")
            time.sleep(interval)
        except (urllib.error.URLError, ConnectionResetError, OSError, ssl.SSLError) as e:
            if state.footer is not None:
                state.footer.note_disconnect(str(e))
            delay = _BACKOFF_SEQUENCE[min(attempt, len(_BACKOFF_SEQUENCE) - 1)]
            failure_wallclock += delay
            if failure_wallclock >= opts.max_reconnect_wallclock_seconds:
                print(
                    f"[live-tail exited: server unreachable for "
                    f"{opts.max_reconnect_wallclock_seconds}s. "
                    f"Run team_refresh_panes to re-attach.]"
                )
                return 1
            print(f"{DIM}poll interrupted ({e}); retrying in {delay}s{RST}")
            attempt += 1
            time.sleep(delay)


def _render_polled_messages(
    msgs: list,
    state: SessionState,
    seen_parts: dict[str, int],
    seen_status: dict[str, str],
    seen_finish: set[str],
) -> bool:
    """Render newly-grown content from a /session/<id>/message snapshot.

    Returns True iff at least one line was printed this tick.
    """
    rendered = False
    for m in msgs:
        info = m.get("info") or {}
        msg_id = info.get("id") or ""
        role = (info.get("role") or "ASSISTANT").upper()
        if msg_id:
            state.role_by_message[msg_id] = role
        ts = fmt_ts(int(time.time() * 1000))
        finish = info.get("finish")
        if msg_id and finish and msg_id not in seen_finish:
            seen_finish.add(msg_id)
            print(f"{ts} {DIM}{role} finish={finish}{RST}")
            rendered = True
        for part in (m.get("parts") or []):
            pid = part.get("id") or ""
            ptype = part.get("type")
            parent_msg = part.get("messageID") or msg_id
            prole = state.role_by_message.get(parent_msg, role)
            text = part.get("text") or ""
            prev_len = seen_parts.get(pid, 0)
            if ptype == "text" and text and len(text) > prev_len:
                seen_parts[pid] = len(text)
                # On first sighting of a peer-coordination text, fold the
                # boilerplate down to a one-line summary (matches the SSE
                # path's behaviour at handle_event:419-421).
                if prev_len == 0:
                    peer = summarize_peer_message(text)
                    if peer:
                        print(f"{ts} {BLU}PEER     {RST} {peer}")
                        rendered = True
                        continue
                colour = CYAN if prole == "ASSISTANT" else GRN
                new_chunk = text[prev_len:]
                print(f"{ts} {colour}{prole:9s}{RST} {short(new_chunk)}")
                rendered = True
            elif ptype == "tool":
                status = (part.get("state") or {}).get("status", "?")
                if status != seen_status.get(pid):
                    seen_status[pid] = status
                    colour = YEL if status != "error" else RED
                    tool = part.get("tool", "?")
                    print(f"{ts} {colour}TOOL     {RST} {tool} → {status}")
                    rendered = True
            elif ptype == "reasoning" and text and len(text) > prev_len:
                seen_parts[pid] = len(text)
                new_chunk = text[prev_len:]
                print(f"{ts} {MAG}REASONING{RST} {short(new_chunk, 80)}")
                rendered = True
    return rendered


def match_session(ev: dict, session_id: str) -> bool:
    props = ev.get("properties", {}) or {}
    candidates = (
        props.get("sessionID"),
        props.get("sessionId"),
        (props.get("info") or {}).get("sessionID"),
        (props.get("info") or {}).get("sessionId"),
        (props.get("part") or {}).get("sessionID"),
        (props.get("part") or {}).get("sessionId"),
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
    if etype == "message.part.delta":
        message_id = props.get("messageID") or props.get("messageId")
        role = state.role_by_message.get(message_id, "ASSISTANT")
        field = props.get("field")
        delta = props.get("delta") or ""
        if field == "text" and delta:
            colour = CYAN if role == "ASSISTANT" else GRN
            print(f"{ts} {colour}{role:9s}{RST} {short(delta)}")
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
    p.add_argument("--insecure", action="store_true", help="Disable TLS certificate verification (local/dev only).")
    p.add_argument("--poll-interval-seconds", type=float, default=1.0, metavar="N",
                   help="How often to poll /session/<id>/message (default 1.0s).")
    # Back-compat: kept so older team_refresh_panes invocations don't crash on
    # the unknown flag. Value is ignored — SSE has been replaced by polling.
    p.add_argument("--idle-heartbeat-seconds", type=int, default=30, metavar="N",
                   help="Deprecated, ignored (SSE replaced by polling).")
    p.add_argument("--max-reconnect-wallclock-seconds", type=int, default=90, metavar="N")
    p.add_argument("--no-footer", action="store_true")
    args = p.parse_args()

    if not args.no_clear:
        print("\033[2J\033[H", end="")
    state = SessionState(args.url, args.session_id, insecure=args.insecure)
    state.fetch()
    render_banner(state)
    if args.insecure:
        print(f"{YEL}{DIM}TLS verify disabled (--insecure). Local/dev use only.{RST}")

    if not args.no_footer:
        state.footer = StatusFooter(state.url)
        state.footer.start()

    fetch_history(state, args.history)
    opts = _PollOpts(
        poll_interval_seconds=args.poll_interval_seconds,
        max_reconnect_wallclock_seconds=args.max_reconnect_wallclock_seconds,
    )
    result = poll_session_messages(state, opts)

    if state.footer is not None:
        state.footer.stop()

    return result


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print(f"\n{DIM}interrupted{RST}")
        sys.exit(130)
