#!/usr/bin/env python3
"""Score an opencode run --format json JSONL for Sisyphus-on-DeepSeek diagnostics.

Schema (verified against opencode run --format json):
  {"type": "step_start|tool_use|text|step_finish|error|reasoning", "part": {...}, "sessionID": ...}
  - text: part.text
  - tool_use: part.tool (name), part.state.input / part.state.output
  - step_finish: part.type == "step-finish"

Usage: score.py <run.jsonl> [task-label]
"""
import json
import re
import sys
from collections import Counter

CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")
DRIFT_MARKERS = ["chatcmpl-tool", '"tool_calls"', "tool_calls:", "function_call:"]
ERROR_MARKERS = [
    "insufficient balance", "http 400", "http 401", "http 429", "http 500",
    "api error", "rate limit", "internal server error", "network error",
    "task not found", "[error]", "etimedout", "operation timed out", "request timed out",
]
DELEGATION_TOOLS = {"task", "call_omo_agent"}
TODO_TOOLS = {"task_create", "task_update", "task_list", "todo_create", "todo_update"}


def main(path, label):
    events = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    text_parts = []
    tool_names = Counter()
    reasoning_blocks = 0
    error_samples = []
    drift_hits = []
    cjk_hits = []
    finish_seen = False
    finish_type = None
    session_ids = set()
    usage = {"input": 0, "output": 0}

    for ev in events:
        etype = ev.get("type", "?")
        part = ev.get("part") or {}
        sid = ev.get("sessionID")
        if sid:
            session_ids.add(sid)

        if etype == "text":
            t = part.get("text", "")
            text_parts.append(t)
            if CJK_RE.search(t):
                cjk_hits.append(t[:150])
            for m in DRIFT_MARKERS:
                if m.lower() in t.lower():
                    drift_hits.append(t[:200])
        elif etype == "tool_use":
            tool = part.get("tool", "?")
            tool_names[tool] += 1
            raw = json.dumps(part.get("state", {}))
            if "guardrails.md" in raw:
                raw = ""
            for m in ERROR_MARKERS:
                if m in raw.lower():
                    error_samples.append(f"{tool}: {raw[:200]}")
        elif etype == "reasoning":
            reasoning_blocks += 1
        elif etype == "step_finish":
            finish_seen = True
            finish_type = part.get("type", "step-finish")
        elif etype == "error":
            error_samples.append(str(part)[:300])
        # usage best-effort anywhere in event
        s = json.dumps(ev)
        for m in re.finditer(r'"(input_tokens|output_tokens|inputTokens|outputTokens)"\s*:\s*(\d+)', s):
            key = m.group(1).lower()
            usage["input" if "input" in key else "output"] += int(m.group(2))

    delegation = {t: tool_names[t] for t in DELEGATION_TOOLS if tool_names[t]}
    todos = {t: tool_names[t] for t in TODO_TOOLS if tool_names[t]}
    final_text = text_parts[-1] if text_parts else ""

    report = {
        "label": label,
        "session_ids": sorted(session_ids),
        "events": len(events),
        "finished": finish_seen,
        "finish_type": finish_type,
        "error_events": len(error_samples),
        "error_samples": error_samples[:5],
        "drift_marker_hits": len(drift_hits),
        "drift_samples": drift_hits[:3],
        "cjk_text_hits": len(cjk_hits),
        "cjk_samples": cjk_hits[:3],
        "reasoning_blocks": reasoning_blocks,
        "delegation_tool_uses": delegation,
        "todo_tool_uses": todos,
        "tool_use_counts": dict(tool_names.most_common(30)),
        "tokens_seen": usage,
        "final_text_len": len(final_text),
        "final_text_head": final_text[:500],
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
