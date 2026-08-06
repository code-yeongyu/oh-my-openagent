"""Interactive batch monitor for paneless dispatch workers."""

from __future__ import annotations

import argparse
import json
import os
import select
import shutil
import sys
import termios
import textwrap
import time
import tty
import unicodedata
from pathlib import Path
from typing import Any

from . import herdr, ledger, mcp_server

try:
    from wcwidth import wcswidth as _wcswidth
except ImportError:  # pragma: no cover - fallback for minimal Python installs
    def _wcswidth(value: str) -> int:
        return sum(0 if unicodedata.combining(char) else
                   2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
                   for char in value)

REFRESH_SECONDS = 1.0
INPUT_POLL_SECONDS = 0.1
CLEAR = "\x1b[2J\x1b[H"
ALT_ON = "\x1b[?1049h\x1b[?25l"
ALT_OFF = "\x1b[?25h\x1b[?1049l"
RESET = "\x1b[0m"
DIM = "\x1b[38;5;247m"
BRIGHT = "\x1b[1;97m"
CYAN = "\x1b[96m"
GREEN = "\x1b[92m"
AMBER = "\x1b[93m"
RED = "\x1b[91m"
SELECTED = "\x1b[1;97;48;5;24m"
INVERSE = "\x1b[30;106m"


def _safe_text(value: Any, keep_newlines: bool = False) -> str:
    text = mcp_server.strip_ansi(str(value or ""))
    safe: list[str] = []
    for char in text:
        if char == "\n" and keep_newlines:
            safe.append(char)
        elif char == "\t":
            safe.append("    ")
        elif unicodedata.category(char) not in {"Cc", "Cf"}:
            safe.append(char)
    return "".join(safe)


def _one_line(value: Any) -> str:
    return " ".join(_safe_text(value).split())


def snapshot(project: Path, owner: str, group: str) -> dict[str, Any]:
    with ledger.open_db(project) as conn:
        rows = [r for r in ledger.select_workers(conn, owner, group=group)
                if r["mode"] != "monitor"]
        now = time.time()
        items: list[dict[str, Any]] = []
        unconsumed = 0
        recent = [
            {"name": r["name"], "body": r["body"]}
            for r in conn.execute(
                "SELECT w.name AS name, r.body AS body FROM reports r"
                " JOIN workers w ON w.id = r.worker_id"
                " WHERE w.owner=? AND w.group_name=? AND r.is_final=1"
                " ORDER BY r.id DESC LIMIT 5",
                (owner, group),
            )
        ]
        for row in rows:
            final = conn.execute(
                "SELECT created_at FROM reports"
                " WHERE worker_id=? AND is_final=1 ORDER BY id DESC LIMIT 1",
                (row["id"],),
            ).fetchone()
            unconsumed += len(ledger.unconsumed_reports(conn, row["id"]))
            if final:
                state = "reported"
            elif row["status"] == "dead":
                state = "dead"
            elif row["status"] == "pending":
                state = "pending"
            elif row["closed_at"] is not None:
                state = "closed"
            else:
                state = "running"
            terminal_at = final["created_at"] if final else row["closed_at"]
            elapsed_until = float(terminal_at) if terminal_at is not None else now
            prompt = str(row["prompt_text"] or "")
            if not prompt:
                prompt_path = project / ".agent-control" / "prompts" / f"{row['name']}-{row['id']}.md"
                try:
                    prompt = prompt_path.read_text(encoding="utf-8")
                except OSError:
                    pass
            items.append({
                "id": int(row["id"]), "name": row["name"], "state": state,
                "elapsed": max(0, int(elapsed_until - row["spawned_at"])),
                "close_reason": row["close_reason"],
                "pid": row["pid"], "model": row["model"], "agent": row["agent"] or "build",
                "prompt": prompt, "prompt_preview": _one_line(prompt),
                "events_path": str(mcp_server.run_live_dir(project, str(row["name"]), int(row["id"])) / "events.jsonl"),
                "stderr_path": str(mcp_server.run_live_dir(project, str(row["name"]), int(row["id"])) / "stderr.log"),
            })
    counts = {state: 0 for state in ("pending", "running", "reported", "dead", "closed")}
    for item in items:
        counts[item["state"]] += 1
    done = counts["reported"] + counts["dead"] + counts["closed"]
    return {
        "group": group, "items": items, "counts": counts, "recent": recent,
        "total": len(items), "done": done, "unconsumed": unconsumed,
        "complete": bool(items) and done == len(items),
    }


def _state_label(item: dict[str, Any]) -> str:
    labels = {
        "running": "RUN ", "pending": "WAIT", "reported": "DONE",
        "dead": "DEAD", "closed": "STOP",
    }
    return labels.get(str(item.get("state", "unknown")), "????")


def _style(text: str, code: str) -> str:
    return f"{code}{text}{RESET}"


def _cell_width(value: Any) -> int:
    return max(0, _wcswidth(_safe_text(value)))


def _clip_cells(value: Any, width: int, placeholder: str = "…") -> str:
    text = _safe_text(value)
    if _cell_width(text) <= width:
        return text
    marker = placeholder if _cell_width(placeholder) <= width else ""
    limit = max(0, width - _cell_width(marker))
    result = ""
    for char in text:
        candidate = result + char
        if _cell_width(candidate) > limit:
            break
        result = candidate
    return result + marker


def _wrap_cells(value: Any, width: int) -> list[str]:
    lines: list[str] = []
    for source in _safe_text(value, keep_newlines=True).splitlines() or [""]:
        remaining = source
        if not remaining:
            lines.append("")
            continue
        while _cell_width(remaining) > width:
            chunk = _clip_cells(remaining, width, placeholder="")
            split = chunk.rfind(" ")
            if split > 0:
                chunk = chunk[:split]
            lines.append(chunk)
            remaining = remaining[len(chunk):].lstrip()
        lines.append(remaining)
    return lines


def _fit(value: Any, width: int, placeholder: str = "…") -> str:
    text = _clip_cells(value, width, placeholder)
    return text + " " * max(0, width - _cell_width(text))


def _parts(parts: list[tuple[str, str | None]], width: int) -> str:
    used = 0
    output: list[str] = []
    for value, color in parts:
        text = _safe_text(value)
        room = max(0, width - used)
        text = _clip_cells(text, room, placeholder="")
        used += _cell_width(text)
        output.append(_style(text, color) if color else text)
    output.append(" " * max(0, width - used))
    return "".join(output)


def _border(left: str, fill: str, right: str, width: int) -> str:
    return _style(left + fill * max(0, width - 2) + right, DIM)


def _status_parts(counts: dict[str, int], compact: bool = False) -> list[tuple[str, str | None]]:
    if compact:
        return [(f"R{counts['running']}", CYAN), (" ", None),
                (f"W{counts['pending']}", AMBER), (" ", None),
                (f"D{counts['reported']}", GREEN), (" ", None),
                (f"X{counts['dead']}", RED)]
    return [(f"RUN {counts['running']}", CYAN), ("  ", None),
            (f"WAIT {counts['pending']}", AMBER), ("  ", None),
            (f"DONE {counts['reported']}", GREEN), ("  ", None),
            (f"DEAD {counts['dead']}", RED)]


def _header(snap: dict[str, Any], width: int) -> list[str]:
    group = _safe_text(snap["group"])
    total, done = snap["total"], snap["done"]
    active = snap["counts"]["running"] + snap["counts"]["pending"]
    terminal_badge = f"[{done}/{total} TERMINAL]" if width >= 72 else f"[{done}/{total}]"
    active_badge = f"[{active} ACTIVE]" if width >= 72 else f"[{active} LIVE]"
    left = f" batch:{group} "
    right_size = _cell_width(terminal_badge) + _cell_width(active_badge) + 3
    middle = max(1, width - _cell_width(left) - right_size - 2)
    title = (_style("┌", DIM) + _style(left, BRIGHT) + _style("─" * middle, DIM)
             + _style(terminal_badge, GREEN) + "  " + _style(active_badge, CYAN)
             + " " + _style("┐", DIM))

    inner = width - 4
    gauge_width = 10 if width < 72 else 16 if width < 105 else 24
    filled = round(gauge_width * done / total) if total else 0
    compact = width < 62
    status_parts = _status_parts(snap["counts"], compact)
    status_size = sum(_cell_width(text) for text, _ in status_parts)
    gauge_size = gauge_width + 7
    gap = max(1, inner - gauge_size - status_size)
    progress_parts = [("[", DIM), ("#" * filled, CYAN),
                      ("-" * (gauge_width - filled), DIM), ("]", DIM),
                      (f" {round(100 * done / total) if total else 0}%", BRIGHT),
                      (" " * gap, None), *status_parts]
    progress = _style("│ ", DIM) + _parts(progress_parts, inner) + _style(" │", DIM)
    return [title, progress]


def _worker_row(item: dict[str, Any], active: bool, width: int) -> str:
    label = _state_label(item).strip()
    name_width = min(18, max(10, width // 4))
    prefix = f"{'▶' if active else ' '} {label:<4} {_fit(item['name'], name_width)} {item['elapsed'] // 60:02d}:{item['elapsed'] % 60:02d}  "
    preview = _fit(item["prompt_preview"] or "(prompt unavailable)", max(0, width - _cell_width(prefix)))
    text = _clip_cells(prefix + preview, width, placeholder="")
    if active:
        return _style(_fit(text, width, ""), SELECTED)
    color = {"RUN": CYAN, "WAIT": AMBER, "DONE": GREEN, "DEAD": RED, "STOP": RED}.get(label, DIM)
    cursor = "  "
    return (cursor + _style(f"{label:<4}", color) + " " + _style(_fit(item["name"], name_width), BRIGHT)
            + " " + _style(f"{item['elapsed'] // 60:02d}:{item['elapsed'] % 60:02d}", DIM) + "  "
            + _style(_fit(item["prompt_preview"] or "(prompt unavailable)", max(0, width - _cell_width(prefix))), DIM))


def load_live_events(path: str, max_lines: int = 500, max_bytes: int = 2_000_000) -> list[dict[str, Any]]:
    """Read a bounded tail of OpenCode's append-only JSON event stream."""
    try:
        with open(path, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            size = stream.tell()
            offset = max(0, size - max_bytes)
            stream.seek(offset)
            if offset:
                stream.readline()
            lines = stream.readlines()[-max_lines:]
    except OSError:
        return []
    events: list[dict[str, Any]] = []
    for line in lines:
        try:
            payload = json.loads(line)
        except (UnicodeDecodeError, ValueError):
            continue
        if isinstance(payload, dict):
            events.append(payload)
    return events


def _event_summary(event: dict[str, Any]) -> tuple[str, str, str]:
    event_type = str(event.get("type", "event"))
    timestamp = event.get("timestamp")
    try:
        stamp = time.strftime("%H:%M:%S", time.localtime(float(timestamp) / 1000))
    except (TypeError, ValueError, OSError):
        stamp = "--:--:--"
    part = event.get("part") if isinstance(event.get("part"), dict) else {}
    if event_type == "tool_use":
        state = part.get("state") if isinstance(part.get("state"), dict) else {}
        tool = _one_line(part.get("tool", "tool"))
        status = _one_line(state.get("status", "running")).upper()
        title = _one_line(state.get("title", ""))
        inputs = state.get("input") if isinstance(state.get("input"), dict) else {}
        if title:
            detail = title
        else:
            preferred = ("filePath", "path", "uri", "query", "pattern", "target", "command",
                         "name", "group", "mode", "action")
            values = [f"{key}={_one_line(inputs[key])}" for key in preferred
                      if inputs.get(key) is not None and inputs.get(key) != ""]
            if values:
                detail = " · ".join(values[:2])
            elif inputs:
                detail = "inputs: " + ", ".join(str(key) for key in list(inputs)[:5])
            else:
                detail = "no input"
        return stamp, f"TOOL {status} {tool}", detail
    if event_type == "text":
        return stamp, "TEXT", _one_line(part.get("text", ""))
    if event_type == "step_start":
        return stamp, "STEP", "model turn started"
    if event_type == "step_finish":
        tokens = part.get("tokens") if isinstance(part.get("tokens"), dict) else {}
        detail = f"reason={part.get('reason', '-')} · tokens={tokens.get('total', '-')}"
        return stamp, "FINISH", detail
    return stamp, event_type.upper(), _one_line(json.dumps(part, ensure_ascii=False))


def render_live_session(item: dict[str, Any], width: int, height: int,
                        scroll_from_bottom: int = 0, raw: bool = False,
                        follow: bool = True) -> str:
    width, height = max(40, width), max(16, height)
    events = load_live_events(str(item.get("events_path", "")))
    title = f" LIVE SESSION {item.get('name', '-')} "
    mode = "[FOLLOW]" if follow else "[PAUSED]"
    right = f"{mode}  {'RAW' if raw else 'SUMMARY'} "
    gap = max(1, width - 2 - _cell_width(title) - _cell_width(right))
    lines = [_style("┌", DIM) + _style(title, BRIGHT) + _style("─" * gap, DIM)
             + _style(mode, GREEN if follow else AMBER) + "  "
             + _style("RAW" if raw else "SUMMARY", CYAN) + " " + _style("┐", DIM)]
    lines.append(_style("│", DIM) + _parts([
        (f" events {len(events)} · {item.get('events_path', '-')}", DIM)
    ], width - 2) + _style("│", DIM))
    lines.append(_style("├" + "─" * (width - 2) + "┤", DIM))
    page = max(1, height - 6)
    start = max(0, len(events) - page - max(0, scroll_from_bottom))
    page_events = events[start:start + page]
    for event in page_events:
        if raw:
            content = _one_line(json.dumps(event, ensure_ascii=False, separators=(",", ":")))
            parts = [(" " + content, DIM)]
        else:
            stamp, kind, detail = _event_summary(event)
            color = CYAN if kind.startswith("TOOL") else GREEN if kind == "FINISH" else BRIGHT if kind == "TEXT" else DIM
            prefix = f" {stamp}  {kind:<18} "
            parts = [(prefix, color), (detail, None)]
        lines.append(_style("│", DIM) + _parts(parts, width - 2) + _style("│", DIM))
    if not events:
        removed = item.get("state") in {"reported", "dead", "closed"} and not Path(str(item.get("events_path", ""))).exists()
        lines.append(_style("│", DIM) + _parts([
            (" Session artifacts were removed by collect." if removed
             else " Waiting for the first OpenCode event…", DIM if removed else AMBER)
        ], width - 2) + _style("│", DIM))
    while len(lines) < height - 2:
        lines.append(_style("│", DIM) + " " * (width - 2) + _style("│", DIM))
    footer = [(" ↑↓", INVERSE), (" scroll  ", DIM), ("F", INVERSE), (" follow  ", DIM),
              ("R", INVERSE), (" raw/summary  ", DIM), ("Esc", INVERSE), (" back", DIM)]
    lines.append(_style("│", DIM) + _parts(footer, width - 2) + _style("│", DIM))
    lines.append(_border("└", "─", "┘", width))
    return "\n".join(lines[:height])


def render(snap: dict[str, Any], selected: int = 0, width: int | None = None,
           height: int | None = None, flash: str = "") -> str:
    width = max(40, width or shutil.get_terminal_size((100, 30)).columns)
    height = max(16, height or shutil.get_terminal_size((100, 30)).lines)
    lines = _header(snap, width)
    items = snap["items"]
    selected = max(0, min(selected, max(0, len(items) - 1)))
    wide = width >= 128
    body_rows = max(4, height - 8)
    if wide:
        inner = width - 3
        left_width = max(48, int(inner * .55))
        right_width = inner - left_width
        lines.append(_style("├" + "─" * left_width + "┬" + "─" * right_width + "┤", DIM))
        lines.append(_style("│", DIM) + _parts([(" WORKERS / INJECTED PROMPT", DIM)], left_width)
                     + _style("│", DIM) + _parts([(" INSPECTOR", DIM)], right_width) + _style("│", DIM))
        item = items[selected] if items else None
        prompt_lines = _wrap_cells(item["prompt"] if item else "No workers.", max(12, right_width - 3))
        for row_index in range(body_rows):
            left = _worker_row(items[row_index], row_index == selected, left_width) if row_index < len(items) else " " * left_width
            if item is None:
                right_parts = [(" No workers in this workflow.", DIM)] if row_index == 0 else []
            elif row_index == 0:
                right_parts = [(f" {item['name']}  ", BRIGHT), (_state_label(item).strip(),
                               {"RUN": CYAN, "WAIT": AMBER, "DONE": GREEN, "DEAD": RED}.get(_state_label(item).strip(), RED))]
            elif row_index == 1:
                right_parts = [(f" pid {item['pid'] or '-'} · {item['model']}", DIM)]
            elif row_index == 2:
                right_parts = [(f" agent {item['agent']} · attempt {item['id']}", DIM)]
            elif 4 <= row_index < 4 + len(prompt_lines):
                right_parts = [(" " + prompt_lines[row_index - 4], None)]
            elif row_index == 5 + len(prompt_lines):
                right_parts = [(" — injected contract —", CYAN)]
            elif row_index == 6 + len(prompt_lines):
                right_parts = [(" Use Report exactly once.", DIM)]
            elif row_index == 7 + len(prompt_lines):
                right_parts = [(" Detailed evidence → report document.", DIM)]
            else:
                right_parts = []
            lines.append(_style("│", DIM) + left + _style("│", DIM)
                         + _parts(right_parts, right_width) + _style("│", DIM))
        latest_parts: list[tuple[str, str | None]] = []
        if snap["recent"]:
            latest = snap["recent"][0]
            latest_parts = [(f" LATEST {latest['name']} · ", GREEN), (_one_line(latest["body"]), DIM)]
        lines.append(_style("│", DIM) + _parts(latest_parts, left_width) + _style("│", DIM)
                     + " " * right_width + _style("│", DIM))
        lines.append(_style("├" + "─" * left_width + "┴" + "─" * right_width + "┤", DIM))
    else:
        lines.append(_style("├" + "─" * (width - 2) + "┤", DIM))
        lines.append(_style("│", DIM) + _parts([(" WORKERS / PROMPT PREVIEW", DIM)], width - 2) + _style("│", DIM))
        start = max(0, min(selected - body_rows // 2, max(0, len(items) - body_rows)))
        for index in range(start, start + body_rows):
            row = _worker_row(items[index], index == selected, width - 2) if index < len(items) else " " * (width - 2)
            lines.append(_style("│", DIM) + row + _style("│", DIM))
        latest_parts = []
        if snap["recent"]:
            latest = snap["recent"][0]
            latest_parts = [(f" LATEST {latest['name']} · ", GREEN), (_one_line(latest["body"]), DIM)]
        lines.append(_style("│", DIM) + _parts(latest_parts, width - 2) + _style("│", DIM))
        lines.append(_style("├" + "─" * (width - 2) + "┤", DIM))

    if flash:
        footer_parts = [(_safe_text(flash), AMBER)]
    elif snap["complete"]:
        footer_parts = [(" Complete · ", GREEN),
                        ("waiting for leader collect" if snap["unconsumed"] else "reports collected", DIM)]
    else:
        footer_parts = [(" ↑↓", INVERSE), (" select  ", DIM), ("Enter", INVERSE), (" prompt  ", DIM),
                        ("L", INVERSE), (" live  ", DIM), ("K", INVERSE), (" kill  ", DIM),
                        ("R", INVERSE), (" restart", DIM)]
        if width >= 72:
            used = sum(_cell_width(text) for text, _ in footer_parts)
            footer_parts += [(" " * max(1, width - 2 - used - 17), None), ("Q STOP WORKFLOW", RED)]
        else:
            footer_parts += [("  Q stop", DIM)]
    lines.append(_style("│", DIM) + _parts(footer_parts, width - 2) + _style("│", DIM))
    lines.append(_border("└", "─", "┘", width))
    return "\n".join(lines[:height])


def render_prompt(item: dict[str, Any], width: int, height: int, scroll: int = 0) -> str:
    width = max(40, width)
    height = max(16, height)
    body_width = max(30, width - 4)
    wrapped: list[str] = []
    prompt = _safe_text(item["prompt"] or "(prompt unavailable)", keep_newlines=True)
    wrapped = _wrap_cells(prompt, body_width)
    page = max(1, height - 6)
    scroll = max(0, min(scroll, max(0, len(wrapped) - page)))
    name = _safe_text(item["name"])
    title = f" PROMPT {name} · injected contract "
    lines = [_style("┌", DIM) + _style(title, BRIGHT)
             + _style("─" * max(0, width - _cell_width(title) - 2) + "┐", DIM)]
    meta = (f" {_state_label(item).strip()} · pid {item.get('pid') or '-'} · "
            f"{item.get('model', '-')} · agent {item.get('agent', '-')}")
    lines.append(_style("│", DIM) + _parts([(meta, DIM)], width - 2) + _style("│", DIM))
    lines.append(_style("├" + "─" * (width - 2) + "┤", DIM))
    for line in wrapped[scroll:scroll + page]:
        color = CYAN if line.strip().startswith("---") or "injected contract" in line.lower() else None
        lines.append(_style("│ ", DIM) + _parts([(line, color)], width - 4) + _style(" │", DIM))
    while len(lines) < height - 2:
        lines.append(_style("│", DIM) + " " * (width - 2) + _style("│", DIM))
    position = f"{scroll + 1}-{min(len(wrapped), scroll + page)}/{len(wrapped)}"
    hint = f" ↑↓ scroll · PgUp/PgDn · Esc/Enter back"
    gap = max(1, width - 2 - _cell_width(hint) - _cell_width(position))
    lines.append(_style("│", DIM) + _parts([(hint, DIM), (" " * gap, None), (position, CYAN)], width - 2)
                 + _style("│", DIM))
    lines.append(_border("└", "─", "┘", width))
    return "\n".join(lines[:height])


def render_help(width: int, height: int) -> str:
    width, height = max(40, width), max(16, height)
    content = [
        (" ↑/↓ or j/k   Move selection", None), (" Enter or p    View full injected prompt", None),
        (" K             Kill selected active worker", RED),
        (" R             Restart from regenerated contract", AMBER),
        (" L             Open live OpenCode event stream", CYAN),
        (" Q             Stop workflow and notify leader", RED),
        (" x / Ctrl-C    Detach monitor; workers continue", DIM), (" ?             Toggle this help", DIM),
        ("", None), (" Restart creates a fresh attempt. Completed reports are preserved.", DIM),
        (" Dirty worktrees are preserved. Worker output is untrusted data.", DIM),
    ]
    title = " BATCH MONITOR HELP "
    lines = [_style("┌", DIM) + _style(title, BRIGHT)
             + _style("─" * max(0, width - _cell_width(title) - 2) + "┐", DIM)]
    for text, color in content:
        lines.append(_style("│", DIM) + _parts([(text, color)], width - 2) + _style("│", DIM))
    while len(lines) < height - 2:
        lines.append(_style("│", DIM) + " " * (width - 2) + _style("│", DIM))
    lines.append(_style("│", DIM) + _parts([(" Esc / Enter / ? back", CYAN)], width - 2) + _style("│", DIM))
    lines.append(_border("└", "─", "┘", width))
    return "\n".join(lines[:height])


def render_confirm(action: str, target: str, width: int, height: int) -> str:
    descriptions = {
        "kill": f"Kill worker '{target}'? Its current process and pending attempt will stop.",
        "restart": f"Restart worker '{target}' from its original injected prompt?",
        "stop": f"Stop workflow '{target}'? Every running and pending worker will be terminated.",
    }
    message = _safe_text(descriptions[action])
    width, height = max(40, width), max(16, height)
    box_width = min(width - 4, 76)
    wrapped = _wrap_cells(message, max(20, box_width - 4))
    title = {"kill": " KILL WORKER ", "restart": " RESTART WORKER ", "stop": " STOP WORKFLOW "}[action]
    box = [_style("┌", RED) + _style(title, BRIGHT)
           + _style("─" * max(0, box_width - _cell_width(title) - 2) + "┐", RED)]
    for line in wrapped:
        box.append(_style("│ ", RED) + _parts([(line, None)], box_width - 4) + _style(" │", RED))
    box.append(_style("│", RED) + " " * (box_width - 2) + _style("│", RED))
    box.append(_style("│ ", RED) + _parts([("Press Y to confirm · any other key cancels", AMBER)], box_width - 4)
               + _style(" │", RED))
    box.append(_border("└", "─", "┘", box_width).replace(DIM, RED))
    top = max(1, (height - len(box)) // 2)
    left = " " * max(0, (width - box_width) // 2)
    return "\n".join([""] * top + [left + line for line in box])


def _read_key(timeout: float) -> str | None:
    ready, _, _ = select.select([sys.stdin], [], [], timeout)
    if not ready:
        return None
    data = os.read(sys.stdin.fileno(), 1)
    if not data:
        return "EOF"
    if data == b"\x1b":
        sequence = data
        while select.select([sys.stdin], [], [], 0.01)[0]:
            sequence += os.read(sys.stdin.fileno(), 1)
        return {b"\x1b[A": "UP", b"\x1b[B": "DOWN", b"\x1b[5~": "PGUP",
                b"\x1b[6~": "PGDN"}.get(sequence, "ESC")
    if data in {b"\r", b"\n"}:
        return "ENTER"
    if data == b"\x03":
        return "CTRL_C"
    return data.decode(errors="ignore")


def _notify_workflow_stopped(owner: str, group: str, stopped: int,
                             failed: list[str] | None = None) -> None:
    failed = failed or []
    marker = (f"[AGENT_WORKFLOW_STOPPED {group}] 사용자가 batch monitor에서 workflow를 종료했다 "
              f"— {stopped}개 active worker 중단")
    if failed:
        marker += f", 종료 확인 실패: {', '.join(_safe_text(name) for name in failed)}"
    if owner and not owner.startswith("owner:"):
        try:
            herdr.send(owner, marker, wait_idle=False)
            return
        except herdr.HerdrError:
            pass
    try:
        herdr.notify(f"workflow {group} 사용자 종료", marker)
    except herdr.HerdrError:
        pass
    wake_cmd = os.environ.get("AGENT_CONTROL_WAKE_CMD", "")
    if wake_cmd:
        mcp_server.spawn_wake_cmd(wake_cmd)


def _notify_group_complete(project: Path, owner: str, group: str, detail: str) -> bool:
    with ledger.open_db(project) as conn:
        total = ledger.claim_group_completion(conn, owner, group)
    if total is None:
        return False
    marker = f"[AGENT_GROUP_DONE {group}] {total}/{total} terminal ({detail}) — collect로 수거하라"
    if owner and not owner.startswith("owner:"):
        try:
            herdr.send(owner, marker, wait_idle=False)
            return True
        except herdr.HerdrError:
            pass
    try:
        herdr.notify(f"group {group} 완료", marker)
    except herdr.HerdrError:
        pass
    wake_cmd = os.environ.get("AGENT_CONTROL_WAKE_CMD", "")
    if wake_cmd:
        mcp_server.spawn_wake_cmd(wake_cmd)
    return True


def _self_close(project: Path, reason: str = "monitor_done") -> None:
    worker_id = os.environ.get("AGENT_CONTROL_WORKER_ID", "")
    if worker_id:
        try:
            with ledger.open_db(project) as conn:
                ledger.close_worker(conn, int(worker_id), reason)
        except Exception:
            pass
    pane = os.environ.get("HERDR_PANE_ID", "")
    if pane:
        try:
            herdr.close(pane)
        except herdr.HerdrError:
            pass


def run_interactive(project: Path, owner: str, group: str) -> str:
    server = mcp_server.MCPServer(project)
    selected = 0
    view = "list"
    scroll = 0
    live_scroll = 0
    live_follow = True
    live_raw = False
    confirm: tuple[str, str, int | None] | None = None
    flash = ""
    last_refresh = 0.0
    last_screen: str | None = None
    collected_since: float | None = None
    snap = snapshot(project, owner, group)
    old_term = termios.tcgetattr(sys.stdin.fileno())
    sys.stdout.write(ALT_ON)
    sys.stdout.flush()
    tty.setcbreak(sys.stdin.fileno())
    try:
        while True:
            now = time.monotonic()
            if now - last_refresh >= REFRESH_SECONDS:
                server._launch_pending(owner)
                snap = snapshot(project, owner, group)
                selected = max(0, min(selected, max(0, len(snap["items"]) - 1)))
                last_refresh = now
                if snap["complete"] and snap["unconsumed"] == 0 and view == "list" and confirm is None:
                    collected_since = collected_since or now
                else:
                    collected_since = None
            size = shutil.get_terminal_size((100, 30))
            # Avoid writing into the terminal's final cell: many PTYs autowrap that
            # cell before the following newline and shift the right border left.
            render_width = max(40, size.columns - 1)
            if confirm:
                screen = render_confirm(confirm[0], confirm[1], render_width, size.lines)
            elif view == "prompt" and snap["items"]:
                screen = render_prompt(snap["items"][selected], render_width, size.lines, scroll)
            elif view == "live" and snap["items"]:
                screen = render_live_session(
                    snap["items"][selected], render_width, size.lines,
                    live_scroll, live_raw, live_follow,
                )
            elif view == "help":
                screen = render_help(render_width, size.lines)
            else:
                screen = render(snap, selected, render_width, size.lines, flash)
            if screen != last_screen:
                sys.stdout.write(CLEAR + screen)
                sys.stdout.flush()
                last_screen = screen
            key = _read_key(INPUT_POLL_SECONDS)
            if collected_since is not None and time.monotonic() - collected_since >= 1.5:
                return "monitor_done"
            if key is None:
                continue
            flash = ""
            if confirm:
                action, target, expected_id = confirm
                confirm = None
                if key.lower() != "y":
                    flash = "Cancelled"
                    continue
                action_text = {
                    "kill": f"TERMINATING {target}…",
                    "restart": f"RESTARTING {target}…",
                    "stop": f"STOPPING WORKFLOW {group}…",
                }[action]
                sys.stdout.write(CLEAR + render(snap, selected, render_width, size.lines, action_text))
                sys.stdout.flush()
                if action == "kill":
                    result = server.kill_run_worker(owner, target, expected_worker_id=expected_id)
                    flash = f"Killed {target}" if result["status"] == "OK" else f"Kill failed: {result.get('error')}"
                    if result["status"] == "OK":
                        _notify_group_complete(project, owner, group, f"{target} user killed")
                elif action == "restart":
                    result = server.restart_run_worker(owner, target, expected_worker_id=expected_id)
                    flash = (f"Restarted {target} · {result.get('state')}" if result["status"] == "OK"
                             else f"Restart failed: {result.get('error')}")
                else:
                    result = server.stop_run_group(owner, group)
                    if result.get("notify_leader"):
                        _notify_workflow_stopped(
                            owner, group, int(result["stopped"]), list(result.get("failed", [])),
                        )
                    if result["status"] == "OK":
                        return "workflow_stopped"
                    flash = "Stop incomplete: " + ", ".join(result.get("failed", []))
                last_refresh = 0.0
                continue
            if view == "live":
                if key in {"ESC", "ENTER"}:
                    view, live_scroll, live_follow = "list", 0, True
                elif key in {"UP", "k"}:
                    live_follow = False
                    live_scroll += 1
                elif key in {"DOWN", "j"}:
                    live_scroll = max(0, live_scroll - 1)
                    live_follow = live_scroll == 0
                elif key == "PGUP":
                    live_follow = False
                    live_scroll += max(1, size.lines - 6)
                elif key == "PGDN":
                    live_scroll = max(0, live_scroll - max(1, size.lines - 6))
                    live_follow = live_scroll == 0
                elif key in {"f", "F"}:
                    live_follow = not live_follow
                    if live_follow:
                        live_scroll = 0
                elif key in {"r", "R"}:
                    live_raw = not live_raw
                continue
            if view in {"prompt", "help"}:
                if key in {"ESC", "ENTER", "?"}:
                    view, scroll = "list", 0
                elif view == "prompt" and key in {"UP", "k"}:
                    scroll = max(0, scroll - 1)
                elif view == "prompt" and key in {"DOWN", "j"}:
                    scroll += 1
                elif view == "prompt" and key == "PGUP":
                    scroll = max(0, scroll - max(1, size.lines - 7))
                elif view == "prompt" and key == "PGDN":
                    scroll += max(1, size.lines - 7)
                continue
            if key in {"UP", "k"}:
                selected = max(0, selected - 1)
            elif key in {"DOWN", "j"}:
                selected = min(max(0, len(snap["items"]) - 1), selected + 1)
            elif key in {"ENTER", "p"} and snap["items"]:
                view, scroll = "prompt", 0
            elif key in {"l", "L"} and snap["items"]:
                view, live_scroll, live_follow, live_raw = "live", 0, True, False
            elif key == "?":
                view = "help"
            elif key == "K" and snap["items"]:
                item = snap["items"][selected]
                if item["state"] in {"reported", "dead", "closed"}:
                    flash = f"KILL unavailable · {item['name']} is already {_state_label(item).strip()}"
                else:
                    confirm = ("kill", item["name"], item["id"])
            elif key in {"r", "R"} and snap["items"]:
                item = snap["items"][selected]
                if item["state"] == "reported":
                    flash = "Completed reports are preserved and cannot be restarted"
                else:
                    confirm = ("restart", item["name"], item["id"])
            elif key in {"q", "Q"}:
                confirm = ("stop", group, None)
            elif key in {"x", "CTRL_C", "EOF"}:
                return "monitor_detached"
    finally:
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, old_term)
        sys.stdout.write(ALT_OFF)
        sys.stdout.flush()


def run_passive(project: Path, owner: str, group: str) -> str:
    while True:
        snap = snapshot(project, owner, group)
        print(CLEAR + render(snap), flush=True)
        if snap["complete"] and snap["unconsumed"] == 0:
            return "monitor_done"
        time.sleep(REFRESH_SECONDS)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--group", required=True)
    parser.add_argument("--owner", required=True)
    args = parser.parse_args()
    project = Path(args.project)
    reason = "monitor_done"
    try:
        if sys.stdin.isatty() and sys.stdout.isatty():
            reason = run_interactive(project, args.owner, args.group)
        else:
            reason = run_passive(project, args.owner, args.group)
    except KeyboardInterrupt:
        reason = "monitor_detached"
    _self_close(project, reason)


if __name__ == "__main__":
    main()
