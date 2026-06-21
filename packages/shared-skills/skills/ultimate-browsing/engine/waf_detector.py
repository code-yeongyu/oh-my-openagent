"""WAF-product detection from a live response.

Returns a *ranking* of (profile_id, confidence) pairs — never a single verdict.
Single-answer detectors cause cascading wrong plans when misfiring (Codex's
critique). Planner consumes the ranking and tries top candidates in order.

All detectors operate on WAF-vendor artifacts (cookies / headers / body
strings) — never site hostnames. See engine/waf_profiles.yaml for the
profile definitions.
"""
from __future__ import annotations

import fnmatch
import os
import re
from dataclasses import dataclass
from typing import Optional

try:
    import yaml  # PyYAML
except ImportError:
    yaml = None  # type: ignore


PROFILES_PATH = os.path.join(os.path.dirname(__file__), "waf_profiles.yaml")


# In-code safety net — used when waf_profiles.yaml is missing / invalid
# or PyYAML isn't installed. Keeps fetch() working in a degraded-but-sane
# mode. Must stay site-agnostic (No-Site-Name Rule).
_DEFAULT_PROFILES: dict = {
    "unknown_challenge": {
        "detectors": {},
        "confidence_rules": {"strong": 0, "weak": 0},
        "capabilities_needed": ["needs_js_exec"],
        "tls_impersonate_candidates": [
            ["safari", "chrome", "firefox"],
            ["safari_ios", "chrome_android"],
        ],
        "referer_strategies": ["self_root", "google_search", "none"],
        "url_transform_order": ["original", "mobile_subdomain"],
        "fallback_when_challenge": ["playwright_mcp", "playwright_real_chrome"],
        "notes": "in-code default — waf_profiles.yaml unavailable",
    },
}


# Module-level sticky error. Readers call `last_load_error()` after each
# `_load_profiles()` call to surface YAML problems in FetchResult.trace.
_LAST_LOAD_ERROR: Optional[str] = None


@dataclass
class DetectionHit:
    profile_id: str
    confidence: float
    signals: list[str]


def last_load_error() -> Optional[str]:
    """Return the most recent profile-loader error (or None if clean)."""
    return _LAST_LOAD_ERROR


def _load_profiles(path: str = PROFILES_PATH) -> dict:
    """Load profiles with graceful fallback.

    Never raises. On any failure (PyYAML missing, file missing, parse error,
    unexpected shape) it returns a copy of `_DEFAULT_PROFILES` and stores
    the reason in `_LAST_LOAD_ERROR` for the caller to surface.
    """
    global _LAST_LOAD_ERROR
    _LAST_LOAD_ERROR = None

    if yaml is None:
        _LAST_LOAD_ERROR = "PyYAML not installed — using in-code default profile"
        return dict(_DEFAULT_PROFILES)
    try:
        with open(path, "r", encoding="utf-8") as f:
            loaded = yaml.safe_load(f) or {}
    except FileNotFoundError:
        _LAST_LOAD_ERROR = f"waf_profiles.yaml not found at {path}"
        return dict(_DEFAULT_PROFILES)
    except yaml.YAMLError as e:
        _LAST_LOAD_ERROR = f"YAML parse error: {type(e).__name__}: {str(e)[:200]}"
        return dict(_DEFAULT_PROFILES)
    except Exception as e:
        _LAST_LOAD_ERROR = f"profile loader: {type(e).__name__}: {str(e)[:200]}"
        return dict(_DEFAULT_PROFILES)

    if not isinstance(loaded, dict) or not any(k for k in loaded if not k.startswith("_")):
        _LAST_LOAD_ERROR = f"waf_profiles.yaml has no usable profiles"
        return dict(_DEFAULT_PROFILES)

    return loaded


def _cookies_dict(resp) -> dict:
    try:
        return {c.name: c.value for c in resp.cookies.jar}
    except Exception:
        try:
            return dict(resp.cookies) if hasattr(resp, "cookies") else {}
        except Exception:
            return {}


def _headers_dict(resp) -> dict:
    try:
        return {k.lower(): v for k, v in dict(resp.headers).items()}
    except Exception:
        return {}


def _match_patterns(haystack_keys: list[str], patterns: list[str]) -> list[str]:
    """Match literal names or fnmatch patterns (for wildcards like `X-Akamai-*`)."""
    hits: list[str] = []
    lowered_keys = [k.lower() for k in haystack_keys]
    for pat in patterns or []:
        pat_l = pat.lower()
        if any(c in pat for c in "*?["):
            for key in lowered_keys:
                if fnmatch.fnmatchcase(key, pat_l):
                    hits.append(pat)
                    break
        else:
            if pat_l in lowered_keys:
                hits.append(pat)
    return hits


def _score_profile(profile_id: str, profile: dict, resp) -> Optional[DetectionHit]:
    """Apply profile detectors to resp. Returns hit or None."""
    if profile_id.startswith("_"):
        return None
    detectors = profile.get("detectors") or {}
    if not detectors and profile_id != "unknown_challenge":
        return None

    cookies = _cookies_dict(resp)
    headers = _headers_dict(resp)
    body = (getattr(resp, "text", "") or "").lower()
    server = headers.get("server", "")

    signals: list[str] = []

    # Cookie detectors
    cookie_pats = detectors.get("cookie") or []
    for hit in _match_patterns(list(cookies.keys()), cookie_pats):
        signals.append(f"cookie:{hit}")

    # Header detectors
    header_pats = detectors.get("header") or []
    for hit in _match_patterns(list(headers.keys()), header_pats):
        signals.append(f"header:{hit}")

    # Server substring
    for needle in detectors.get("server_contains") or []:
        if needle.lower() in server:
            signals.append(f"server:{needle}")

    # Body markers
    for needle in detectors.get("body") or []:
        if needle.lower() in body:
            signals.append(f"body:{needle}")

    if not signals:
        return None

    rules = profile.get("confidence_rules") or {"strong": 2, "weak": 1}
    n = len(signals)
    if n >= rules.get("strong", 2):
        conf = 0.9
    elif n >= rules.get("weak", 1):
        conf = 0.6
    else:
        conf = 0.3

    return DetectionHit(profile_id=profile_id, confidence=conf, signals=signals)


def detect(resp, *, profiles: Optional[dict] = None, min_confidence: float = 0.0) -> list[DetectionHit]:
    """Return ranked list of detection hits (best first).

    When nothing fires, the returned list contains a single `unknown_challenge`
    hit with confidence 0.1 — caller can use its conservative settings.
    """
    if profiles is None:
        profiles = _load_profiles()

    hits: list[DetectionHit] = []
    for profile_id, profile in profiles.items():
        if profile_id.startswith("_"):
            continue
        h = _score_profile(profile_id, profile, resp)
        if h and h.confidence >= min_confidence:
            hits.append(h)

    hits.sort(key=lambda x: x.confidence, reverse=True)

    if not hits:
        hits.append(DetectionHit(
            profile_id="unknown_challenge",
            confidence=0.1,
            signals=["fallback"],
        ))
    return hits


def load_profile(profile_id: str, *, profiles: Optional[dict] = None) -> dict:
    """Get one profile by id, resolving `unknown_challenge` if missing."""
    if profiles is None:
        profiles = _load_profiles()
    return profiles.get(profile_id) or profiles.get("unknown_challenge") or {}
