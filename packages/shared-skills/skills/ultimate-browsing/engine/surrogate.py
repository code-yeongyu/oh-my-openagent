"""Phase 2.5 surrogate retrieval: archive / reader / proxy routes for blocked origins.

When the curl grid cannot fetch the live page, this module reads a declarative
registry (engine/surrogates.yaml) and tries third-party routes that serve a
copy of the target instead. Provenance semantics are contractual:

    kind=archive -> provenance="snapshot" (+ archive's own timestamp), trust=archive
    kind=reader  -> provenance="live"     (server-side re-render of the live page)
    kind=proxy   -> provenance="proxy", trust=untrusted; requires allow_proxy=True
                    and never sends Cookie/Authorization headers (relay = MITM)

Every response body passes through validators.validate() with target_url set,
so AMP-style redirect stubs and search-engine interstitials are rejected
rather than recorded as wins. Entries whose `last_verified` is older than
MAX_STALE_DAYS are tried after fresh ones (routes rot faster than they are
maintained).
"""
from __future__ import annotations

import json
import os
import time
from datetime import date

try:
    import yaml
except ImportError:
    yaml = None

from .result_schema import Attempt
from .validators import Verdict, validate

SURROGATES_PATH = os.path.join(os.path.dirname(__file__), "surrogates.yaml")
MAX_STALE_DAYS = 90

DEFAULT_SURROGATES: dict = {
    "wayback": {
        "kind": "archive",
        "trust": "archive",
        "enabled": True,
        "last_verified": "2026-08-09",
        "discovery": {
            "url": "https://archive.org/wayback/available?url={target}",
            "flag_pointer": "archived_snapshots.closest.available",
            "snapshot_url_pointer": "archived_snapshots.closest.url",
            "snapshot_timestamp_pointer": "archived_snapshots.closest.timestamp",
        },
        "min_body_bytes": 3072,
    },
}


def load_surrogates(path: str = SURROGATES_PATH) -> dict:
    if yaml is None:
        return dict(DEFAULT_SURROGATES)
    try:
        with open(path, encoding="utf-8") as fh:
            loaded = yaml.safe_load(fh) or {}
    except (OSError, yaml.YAMLError):
        return dict(DEFAULT_SURROGATES)
    if not isinstance(loaded, dict):
        return dict(DEFAULT_SURROGATES)
    usable = {k: v for k, v in loaded.items() if isinstance(v, dict) and k}
    return usable or dict(DEFAULT_SURROGATES)


def is_stale(entry: dict, max_age_days: int = MAX_STALE_DAYS, today: date | None = None) -> bool:
    verified = entry.get("last_verified")
    if isinstance(verified, date):
        parsed = verified
    elif isinstance(verified, str):
        try:
            parsed = date.fromisoformat(verified)
        except ValueError:
            return True
    else:
        return True
    return ((today or date.today()) - parsed).days > max_age_days


def _http_get(url: str, *, headers: dict | None = None, timeout: int = 25):
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError as exc:
        raise RuntimeError("curl_cffi not installed") from exc
    return cffi_requests.get(
        url,
        impersonate="chrome",
        headers=headers or {"Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"},
        timeout=timeout,
        allow_redirects=True,
    )


def _json_pointer(obj, dotted: str):
    current = obj
    for part in dotted.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _provenance_of(kind: str) -> str:
    if kind == "archive":
        return "snapshot"
    if kind == "proxy":
        return "proxy"
    return "live"


def _skip_reason(name: str, entry: dict, allow_proxy: bool) -> str | None:
    kind = entry.get("kind", "archive")
    if kind == "proxy" and not allow_proxy:
        return "proxy_requires_allow_proxy_flag"
    required_env = entry.get("enabled_env")
    if required_env and not os.environ.get(str(required_env)):
        return f"missing_env:{required_env}"
    if entry.get("enabled") is False and kind != "proxy":
        return "disabled"
    return None


def _attempt(name: str, url: str, verdict: Verdict, error=None, status: int = 0, size: int = 0, elapsed: float = 0.0) -> Attempt:
    return Attempt(
        phase="surrogate",
        executor=f"surrogate_{name}",
        url=url,
        url_transform="original",
        impersonate=None,
        referer="",
        status=status,
        body_size=size,
        verdict=verdict.value,
        error=(str(error)[:200] if error else None),
        elapsed_s=round(elapsed, 3),
    )


def _resolve_target(name: str, entry: dict, target: str, timeout: int) -> tuple[str | None, str | None]:
    discovery = entry.get("discovery")
    if not discovery:
        host_rotation = entry.get("host_rotation") or [None]
        host = host_rotation[0]
        template = entry.get("fetch")
        if not template or host is None and "{host}" in template:
            return None, None
        return template.format(host=host, target=target), None
    discovery_url = discovery.get("url", "").format(target=target)
    resp = _http_get(discovery_url, timeout=timeout)
    payload = resp.json()
    if discovery.get("flag_pointer") and not _json_pointer(payload, discovery["flag_pointer"]):
        return None, None
    snap_url = _json_pointer(payload, discovery.get("snapshot_url_pointer", ""))
    timestamp = _json_pointer(payload, discovery.get("snapshot_timestamp_pointer", "")) or None
    return snap_url, timestamp


def run_surrogate(
    target: str,
    *,
    registry: dict | None = None,
    allow_proxy: bool = False,
    timeout: int = 25,
    success_selectors: list[str] | None = None,
) -> tuple[list[Attempt], dict, str]:
    registry = dict(registry) if registry else load_surrogates()
    ordered = sorted(registry.items(), key=lambda kv: int(is_stale(kv[1])))
    live_meta = {"provenance": "live", "snapshot_timestamp": None, "trust": "origin", "surrogate": None}
    attempts: list[Attempt] = []

    for name, entry in ordered:
        kind = entry.get("kind", "archive")
        reason = _skip_reason(name, entry, allow_proxy)
        if reason:
            attempts.append(_attempt(name, target, Verdict.UNKNOWN, error=f"skipped:{reason}"))
            continue
        started = time.time()
        try:
            fetch_url, timestamp = _resolve_target(name, entry, target, timeout)
        except Exception as exc:
            attempts.append(_attempt(name, target, Verdict.UNKNOWN, error=f"{type(exc).__name__}:{exc}", elapsed=time.time() - started))
            continue
        if not fetch_url:
            attempts.append(_attempt(name, target, Verdict.UNKNOWN, error="no snapshot available", elapsed=time.time() - started))
            continue
        try:
            resp = _http_get(fetch_url, timeout=timeout)
        except Exception as exc:
            attempts.append(_attempt(name, fetch_url, Verdict.UNKNOWN, error=f"{type(exc).__name__}:{exc}", elapsed=time.time() - started))
            continue
        body = getattr(resp, "text", "") or ""
        status = int(getattr(resp, "status_code", 0) or 0)
        min_bytes = int(entry.get("min_body_bytes", 3072))
        att = _attempt(name, fetch_url, Verdict.UNKNOWN, status=status, size=len(body), elapsed=time.time() - started)
        attempts.append(att)
        if status >= 400 or len(body) < min_bytes:
            att.error = f"surrogate_unusable:status={status},size={len(body)}"
            continue
        vr = validate(resp, success_selectors=success_selectors, target_url=target)
        att.verdict = vr.verdict.value
        att.reasons = vr.reasons
        if vr.ok:
            meta = {
                "provenance": _provenance_of(kind),
                "snapshot_timestamp": timestamp if kind == "archive" else None,
                "trust": str(entry.get("trust", "archive")),
                "surrogate": name,
            }
            return attempts, meta, body

    if not attempts:
        attempts.append(_attempt("none", target, Verdict.UNKNOWN, error="no surrogate entries"))
    return attempts, live_meta, ""
