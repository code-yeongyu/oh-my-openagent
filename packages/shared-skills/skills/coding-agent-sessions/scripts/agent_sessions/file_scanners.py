from __future__ import annotations

from pathlib import Path
from urllib.parse import unquote, urlparse

from .jsonio import as_map, int_value, iter_jsonl, parse_json_text, read_json, text
from .timeparse import file_time, unix_millis, unix_seconds
from .transcript import content_text, env_path, existing, flat_parallel, jsonl_parallel, recent
from .types import Json, JsonMap, Session


def scan_openclaw(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".openclaw"], extra_roots, (".openclaw",))
    paths: list[Path] = []
    for root in roots:
        paths.extend((root / "agents").glob("*/sessions/*.jsonl"))
        paths.extend((root / "sessions").glob("*.jsonl"))
        paths.extend((root / "session-backups").glob("*/*.jsonl"))
        paths.extend((root / "session-backups").glob("*/sessions/*.jsonl"))
    return jsonl_parallel(recent(paths), workers, "openclaw", lambda path: path.stem)


def scan_droid(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".factory"], extra_roots, (".factory",))
    paths = [path for root in roots for path in (root / "sessions").glob("*/*.jsonl")]
    return flat_parallel(recent(paths), workers, lambda path: [_droid_session(path)])


def scan_amp(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".local" / "share" / "amp"], extra_roots, ("amp", ".local/share/amp"))
    paths = [path for root in roots for path in (root / "threads").glob("T-*.json")]
    return flat_parallel(recent(paths), workers, _amp_sessions)


def scan_gemini(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".gemini"], extra_roots, (".gemini",))
    paths = [path for root in roots for path in (root / "tmp").glob("*/chats/*.json")]
    return flat_parallel(recent(paths), workers, _gemini_sessions)


def scan_kimi(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".kimi"], extra_roots, (".kimi",))
    paths = [path for root in roots for path in (root / "sessions").glob("*/*/wire.jsonl")]
    return flat_parallel(recent(paths), workers, lambda path: [_kimi_session(path)])


def scan_qwen(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / ".qwen"], extra_roots, (".qwen",))
    paths = [path for root in roots for path in (root / "projects").glob("*/chats/*.jsonl")]
    return jsonl_parallel(recent(paths), workers, "qwen", lambda path: path.stem)


def scan_codebuff(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    defaults = [Path.home() / ".config" / name for name in ("manicode", "manicode-dev", "manicode-staging", "codebuff")]
    roots = _roots(defaults, extra_roots, ("manicode", "codebuff"))
    paths = [path for root in roots for path in (root / "projects").glob("*/chats/*/chat-messages.json")]
    return flat_parallel(recent(paths), workers, _codebuff_sessions)


def scan_roocode(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    return _scan_task_dirs("roo-code", "rooveterinaryinc.roo-cline", extra_roots, workers)


def scan_kilocode(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    return _scan_task_dirs("kilo-code", "kilocode.kilo-code", extra_roots, workers)


def scan_cline(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    return _scan_task_dirs("cline", "saoudrizwan.claude-dev", extra_roots, workers)


def scan_aider(extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    roots = _roots([Path.home() / "local-workspaces", Path.home() / "indent"], extra_roots, ("local-workspaces",))
    paths: list[Path] = []
    for root in roots:
        paths.extend(_bounded_named(root, ".aider.chat.history.md"))
    return flat_parallel(recent(paths), workers, _aider_sessions)


def _droid_session(path: Path) -> Session:
    sid = path.stem
    cwd = model = first_user = last_user = None
    created = updated = None
    settings = as_map(read_json(path.with_suffix(".settings.json"))) or {}
    for data in iter_jsonl(path):
        created = created or text(data.get("timestamp"))
        updated = text(data.get("timestamp")) or updated
        if data.get("type") == "session_start":
            sid = text(data.get("id")) or sid
            cwd = cwd or text(data.get("cwd"))
        message = as_map(data.get("message")) or {}
        if message.get("role") == "user":
            prompt = _without_system_reminders(message.get("content"))
            if prompt:
                first_user = first_user or prompt
                last_user = prompt
    return Session("droid", sid, str(path), cwd, created or file_time(path), updated or created or file_time(path), None, text(settings.get("model")) or model, first_user or "", _usage(settings), last_user_message=last_user or "")


def _amp_sessions(path: Path) -> list[Session]:
    data = as_map(read_json(path))
    if data is None:
        return []
    messages = _json_maps(data.get("messages"))
    first_user, last_user = _message_edges(messages)
    env = as_map(data.get("env")) or {}
    initial = as_map(env.get("initial")) or {}
    trees = initial.get("trees")
    tree = as_map(trees[0]) if isinstance(trees, list) and trees else None
    created = int_value(data.get("created"))
    return [
        Session(
            "amp",
            text(data.get("id")) or path.stem,
            str(path),
            _file_uri_path(text(tree.get("uri")) if tree is not None else None),
            unix_millis(created) or file_time(path),
            file_time(path),
            None,
            _tag_model(initial.get("tags")),
            first_user,
            {"message_count": len(messages)},
            last_user_message=last_user,
        )
    ]


def _gemini_sessions(path: Path) -> list[Session]:
    data = as_map(read_json(path))
    if data is None:
        return []
    messages = _json_maps(data.get("messages"))
    first_user, last_user = _message_edges(messages, role_keys=("user",))
    return [Session("gemini", text(data.get("sessionId")) or path.stem, str(path), text(data.get("projectHash")), text(data.get("startTime")) or file_time(path), text(data.get("lastUpdated")) or file_time(path), "google", None, first_user, {"message_count": len(messages)}, last_user_message=last_user)]


def _kimi_session(path: Path) -> Session:
    first_user = last_user = ""
    created = updated = None
    for data in iter_jsonl(path):
        stamp = data.get("timestamp")
        created = created or unix_seconds(stamp if isinstance(stamp, int | float) else None)
        updated = unix_seconds(stamp if isinstance(stamp, int | float) else None) or updated
        payload = as_map(data.get("payload")) or {}
        prompt = text(payload.get("user_input")) if data.get("type") == "TurnBegin" else None
        if prompt:
            first_user = first_user or prompt
            last_user = prompt
    return Session("kimi", path.parent.name, str(path), None, created or file_time(path), updated or file_time(path), "moonshot", None, first_user, {}, last_user_message=last_user)


def _codebuff_sessions(path: Path) -> list[Session]:
    data = read_json(path)
    rows = _json_maps(data)
    first_user, last_user = _message_edges(rows, role_keys=("user", "human"))
    return [Session("codebuff", path.parent.name, str(path), None, file_time(path), file_time(path), None, None, first_user, {"message_count": len(rows)}, last_user_message=last_user)] if rows else []


def _scan_task_dirs(platform: str, extension: str, extra_roots: tuple[Path, ...], workers: int) -> list[Session]:
    appdata = env_path("APPDATA")
    defaults = [
        Path.home() / "Library" / "Application Support" / "Code" / "User" / "globalStorage" / extension,
        Path.home() / ".config" / "Code" / "User" / "globalStorage" / extension,
        *(path / "Code" / "User" / "globalStorage" / extension for path in (appdata,) if path is not None),
    ]
    roots = _roots(defaults, extra_roots, (extension,))
    paths = [path for root in roots for path in (root / "tasks").glob("*/api_conversation_history.json")]
    return flat_parallel(recent(paths), workers, lambda path: _task_sessions(platform, path))


def _task_sessions(platform: str, path: Path) -> list[Session]:
    data = read_json(path)
    rows = _json_maps(data)
    first_user, last_user = _message_edges(rows, role_keys=("user",))
    return [Session(platform, path.parent.name, str(path), None, file_time(path), file_time(path), None, None, first_user, {"message_count": len(rows)}, last_user_message=last_user)] if rows else []


def _aider_sessions(path: Path) -> list[Session]:
    text_value = path.read_text(encoding="utf-8", errors="replace")
    sessions: list[Session] = []
    for block in text_value.split("# aider chat started at "):
        if not block.strip():
            continue
        first_line, _, body = block.partition("\n")
        prompt = _first_aider_prompt(body)
        stamp = first_line.strip()
        sid = f"{path.parent.name}-{stamp.replace(':', '-').replace(' ', '-')}"
        sessions.append(Session("aider", sid, str(path), str(path.parent), stamp, file_time(path), None, None, prompt, {}, last_user_message=prompt))
    return sessions


def _message_edges(messages: list[JsonMap], role_keys: tuple[str, ...] = ("user",)) -> tuple[str, str]:
    first_user = ""
    last_user = ""
    for message in messages:
        if text(message.get("role")) not in role_keys and text(message.get("type")) not in role_keys:
            continue
        prompt = _content(message.get("content"))
        if prompt:
            first_user = first_user or prompt
            last_user = prompt
    return first_user, last_user


def _json_maps(value: Json | None) -> list[JsonMap]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _content(value: Json | None) -> str:
    parsed = parse_json_text(value) if isinstance(value, str) else value
    return content_text(parsed) or (value if isinstance(value, str) else "")


def _without_system_reminders(value: Json | None) -> str:
    if not isinstance(value, list):
        return _content(value)
    parts: list[str] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        value_text = text(item.get("text")) or text(item.get("content")) or ""
        if value_text.startswith("<system-reminder>"):
            continue
        parts.append(value_text)
    return "\n".join(part for part in parts if part)


def _usage(data: JsonMap) -> JsonMap:
    usage = as_map(data.get("tokenUsage")) or {}
    return {key: value for key, value in usage.items() if isinstance(value, int | float)}


def _roots(defaults: list[Path], extra_roots: tuple[Path, ...], children: tuple[str, ...]) -> list[Path]:
    candidates = [*defaults]
    for root in extra_roots:
        candidates.append(root)
        candidates.extend(root / child for child in children)
    return existing(candidates)


def _bounded_named(root: Path, name: str) -> list[Path]:
    return [path for pattern in (name, f"*/{name}", f"*/*/{name}") for path in root.glob(pattern)]


def _file_uri_path(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    if parsed.scheme != "file":
        return value
    path = unquote(parsed.path)
    if parsed.netloc and parsed.netloc != "localhost":
        return f"//{parsed.netloc}{path}"
    if len(path) >= 3 and path[0] == "/" and path[2] == ":" and path[1].isalpha():
        return path[1:]
    return path


def _tag_model(value: Json | None) -> str | None:
    if not isinstance(value, list):
        return None
    for item in value:
        tag = text(item)
        if tag is not None and tag.startswith("model:"):
            return tag.removeprefix("model:")
    return None


def _first_aider_prompt(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("#### "):
            return line.removeprefix("#### ").strip()
    return ""
