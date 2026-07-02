from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .jsonio import as_map, dumps, iter_jsonl
from .scanners import DEFAULT_PLATFORMS, scan
from .timeparse import date_bound, parse_stamp
from .transcript import user_text
from .types import Json, JsonMap, Options, Session


def main() -> int:
    command, opts, rest = _parse()
    sessions = sorted(scan(opts.platforms, opts.roots, opts.workers), key=lambda item: item.created_at or "", reverse=True)
    if command == "list":
        _emit(_list_payload(_filter(sessions, opts), sessions, opts.limit, include_subagents=opts.include_subagents))
        return 0
    if command == "search":
        queries = _queries(opts, rest)
        _require(list(queries), "search requires a query")
        _emit(_search_payload(_filter(sessions, opts), sessions, queries, opts.limit, opts.workers, include_subagents=opts.include_subagents))
        return 0
    if command == "get":
        _require(rest, "read requires at least one session id")
        _emit(_get_payload(sessions, rest))
        return 0
    raise SystemExit(f"unknown command: {command}")


def _parse() -> tuple[str, Options, list[str]]:
    import sys

    args = sys.argv[1:]
    if not args or args[0] in {"-h", "--help"}:
        usage = (
            "Usage: find-agent-sessions.py list|find|search|read|get [query|ids...] [--query TEXT ...] "
            "[--platform NAME ...] [--root PATH] [--from DATE] [--to DATE] [--cwd TEXT] "
            "[--model TEXT] [--limit N] [--workers N] [--include-subagents]"
        )
        print(usage)
        raise SystemExit(0)
    command = args.pop(0)
    if command == "find":
        command = "search"
    elif command == "read":
        command = "get"
    roots: list[Path] = []
    queries: list[str] = []
    platforms: list[str] = []
    date_from = date_to = cwd = model = None
    limit = 20
    workers = _default_workers()
    include_subagents = False
    rest: list[str] = []
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--root":
            roots.append(Path(args[index + 1]).expanduser())
            index += 2
        elif arg == "--query":
            queries.append(args[index + 1])
            index += 2
        elif arg == "--platform":
            platform = args[index + 1].strip().lower()
            if "," in platform:
                raise SystemExit("Use repeated --platform flags, for example: --platform senpi --platform opencode")
            platforms.append(platform)
            index += 2
        elif arg == "--from":
            date_from = args[index + 1]
            index += 2
        elif arg == "--to":
            date_to = args[index + 1]
            index += 2
        elif arg == "--cwd":
            cwd = args[index + 1].lower()
            index += 2
        elif arg == "--model":
            model = args[index + 1].lower()
            index += 2
        elif arg == "--limit":
            limit = int(args[index + 1])
            index += 2
        elif arg == "--workers":
            workers = max(int(args[index + 1]), 1)
            index += 2
        elif arg == "--include-subagents":
            include_subagents = True
            index += 1
        else:
            rest.append(arg)
            index += 1
    selected_platforms = frozenset(platforms) if platforms else DEFAULT_PLATFORMS
    return command, Options(selected_platforms, tuple(roots), tuple(queries), date_from, date_to, cwd, model, limit, workers, include_subagents), rest


def _filter(sessions: list[Session], opts: Options) -> list[Session]:
    start = date_bound(opts.date_from)
    end = date_bound(opts.date_to, end=True)
    result: list[Session] = []
    for item in sessions:
        stamp = parse_stamp(item.created_at)
        if start is not None and stamp is not None and stamp < start:
            continue
        if end is not None and stamp is not None and stamp >= end:
            continue
        if opts.cwd is not None and opts.cwd not in (item.cwd or "").lower():
            continue
        if opts.model is not None and opts.model not in (item.model or "").lower():
            continue
        result.append(item)
    return result


def _child_counts(sessions: list[Session]) -> dict[tuple[str, str], int]:
    counts: dict[tuple[str, str], int] = {}
    for item in sessions:
        if item.parent_id is not None:
            key = (item.platform, item.parent_id)
            counts[key] = counts.get(key, 0) + 1
    return counts


def _annotate(item: Session, counts: dict[tuple[str, str], int]) -> JsonMap:
    data = item.to_json()
    data["subagent_count"] = counts.get((item.platform, item.id), 0)
    data["detail_hint"] = _detail_hint(item)
    return data


def _list_payload(filtered: list[Session], all_sessions: list[Session], limit: int, include_subagents: bool = False) -> JsonMap:
    counts = _child_counts(all_sessions)
    candidates = filtered if include_subagents else [item for item in filtered if item.parent_id is None]
    results: list[Json] = [_annotate(item, counts) for item in candidates[:limit]]
    return {"count": len(results), "results": results}


def _search_payload(filtered: list[Session], all_sessions: list[Session], queries: tuple[str, ...], limit: int, workers: int, include_subagents: bool = False) -> JsonMap:
    counts = _child_counts(all_sessions)
    candidates = filtered if include_subagents else [item for item in filtered if item.parent_id is None]
    per_query: list[Json] = []
    merged: dict[tuple[str, str], tuple[Session, list[JsonMap]]] = {}
    with ThreadPoolExecutor(max_workers=min(workers, max(len(queries), 1))) as pool:
        futures = [pool.submit(_search_one, candidates, query, limit) for query in queries]
        for future in as_completed(futures):
            query, matches = future.result()
            per_query.append({"query": query, "count": len(matches), "results": [_annotate_search(item, counts, reasons) for item, reasons in matches]})
            for item, reasons in matches:
                key = (item.platform, item.id)
                if key not in merged:
                    merged[key] = (item, reasons)
    results: list[Json] = [_annotate_search(item, counts, reasons) for item, reasons in list(merged.values())[:limit]]
    return {"count": len(results), "queries": per_query, "results": results}


def _get_payload(sessions: list[Session], ids: list[str]) -> JsonMap:
    counts = _child_counts(sessions)
    results: list[Json] = []
    for item in sessions:
        if item.id not in ids and not any(item.id.startswith(prefix) for prefix in ids):
            continue
        events = _events(item)
        first_prompt, last_prompt = _prompt_edges(item, events)
        session = _annotate(item, counts)
        session["first_user_message"] = first_prompt[:300]
        session["last_user_message"] = last_prompt[:300]
        children = sorted(
            (child for child in sessions if child.platform == item.platform and child.parent_id == item.id),
            key=lambda child: child.created_at or "",
        )
        results.append(
            {
                "session": session,
                "prompts": {"first_user_message": first_prompt, "last_user_message": last_prompt},
                "events": events,
                "subagents": [_annotate(child, counts) for child in children],
                "detail_hint": _detail_hint(item),
            }
        )
    return {"count": len(results), "results": results}


def _annotate_search(item: Session, counts: dict[tuple[str, str], int], reasons: list[JsonMap]) -> JsonMap:
    data = _annotate(item, counts)
    reason_rows: list[Json] = []
    reason_rows.extend(reasons)
    data["match_reasons"] = reason_rows
    return data


def _detail_hint(item: Session) -> str:
    return f"python3 scripts/find-agent-sessions.py read {item.id} --platform {item.platform}"


def _events(item: Session) -> list[Json]:
    if item.path.endswith(".jsonl"):
        return list(iter_jsonl(Path(item.path)))
    events: list[Json] = []
    if item.first_user_message:
        events.append({"type": "message", "message": {"role": "user", "content": item.first_user_message}})
    if item.last_user_message and item.last_user_message != item.first_user_message:
        events.append({"type": "message", "message": {"role": "user", "content": item.last_user_message}})
    return events


def _prompt_edges(item: Session, events: list[Json]) -> tuple[str, str]:
    first_prompt = item.first_user_message
    last_prompt = item.last_user_message or item.first_user_message
    for event in events:
        if not isinstance(event, dict):
            continue
        message = as_map(event.get("message")) or as_map(event.get("payload")) or {}
        prompt = user_text(event, message)
        if prompt:
            first_prompt = first_prompt or prompt
            last_prompt = prompt
    return first_prompt, last_prompt


def _match_reasons(item: Session, query: str) -> list[JsonMap]:
    needle = query.lower()
    reasons: list[JsonMap] = []
    for field, value in _search_fields(item):
        if needle in value.lower():
            reasons.append({"query": query, "platform": item.platform, "field": field, "snippet": _snippet(value, needle)})
    return reasons


def _search_fields(item: Session) -> tuple[tuple[str, str], ...]:
    return (
        ("platform", item.platform),
        ("id", item.id),
        ("path", item.path),
        ("cwd", item.cwd or ""),
        ("provider", item.provider or ""),
        ("model", item.model or ""),
        ("agent", item.agent or ""),
        ("first_user_message", item.first_user_message),
        ("last_user_message", item.last_user_message),
    )


def _snippet(value: str, needle: str) -> str:
    start = max(value.lower().find(needle) - 60, 0)
    end = min(start + 160, len(value))
    return value[start:end]


def _queries(opts: Options, rest: list[str]) -> tuple[str, ...]:
    if opts.queries:
        return opts.queries
    joined = " ".join(rest).strip()
    return (joined,) if joined else ()


def _search_one(sessions: list[Session], query: str, limit: int) -> tuple[str, list[tuple[Session, list[JsonMap]]]]:
    matches: list[tuple[Session, list[JsonMap]]] = []
    for item in sessions:
        reasons = _match_reasons(item, query)
        if reasons:
            matches.append((item, reasons))
    return query, matches[:limit]


def _emit(value: JsonMap) -> None:
    print(dumps(value))


def _require(values: list[str], message: str) -> None:
    if not values:
        raise SystemExit(message)


def _default_workers() -> int:
    cpu = os.cpu_count() or 4
    return min(max(cpu * 4, 8), 64)


if __name__ == "__main__":
    raise SystemExit(main())
