"""Generic URL transforms for the fetch grid.

Transforms are domain-agnostic *rules*. They never reference a specific
site by name. A transform either applies (returns a new URL) or is skipped
(returns None). Callers iterate transforms in order.

Empirically useful transforms (see observations/):
  * mobile_subdomain — `www.example.com` → `m.example.com`
    Strong win on SSR sites with mobile-first serving. Loss on SPA shells
    (some mobile sites return tiny bootstrap HTML).
  * am_prefix — `example.com` (no www) → `m.example.com`
  * drop_www — occasionally unblocks hosts that gate www but not apex.

Adding new transforms: prove they help on ≥2 unrelated sites first
(cross-site validation — bias check).
"""
from __future__ import annotations

from typing import Callable, Optional
from urllib.parse import urlsplit, urlunsplit


def _replace_host(url: str, new_host: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(netloc=new_host))


def _original(url: str) -> Optional[str]:
    return url


def _mobile_subdomain(url: str) -> Optional[str]:
    """`https://www.example.com/a` → `https://m.example.com/a` (only if host starts with www.)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if not host.startswith("www."):
        return None
    new_host = "m." + host[4:]
    if parts.port:
        new_host = f"{new_host}:{parts.port}"
    return _replace_host(url, new_host)


def _am_prefix(url: str) -> Optional[str]:
    """`https://example.com/a` → `https://m.example.com/a` (only if host has no subdomain)."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    if not host or host.startswith("m."):
        return None
    # Only apply to apex-like hosts (≤2 dot-separated labels).
    if host.count(".") >= 2 and not host.startswith("www."):
        return None
    if host.startswith("www."):
        return None  # handled by mobile_subdomain
    return _replace_host(url, "m." + host)


def _drop_www(url: str) -> Optional[str]:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if not host.startswith("www."):
        return None
    return _replace_host(url, host[4:])


TRANSFORMS: dict[str, Callable[[str], Optional[str]]] = {
    "original": _original,
    "mobile_subdomain": _mobile_subdomain,
    "am_prefix": _am_prefix,
    "drop_www": _drop_www,
}


def apply_transform(name: str, url: str) -> Optional[str]:
    """Apply one transform by name. Returns transformed URL or None if skipped."""
    fn = TRANSFORMS.get(name)
    if fn is None:
        raise ValueError(f"Unknown transform: {name!r}. Known: {list(TRANSFORMS)}")
    return fn(url)


def iter_transformed(url: str, order: list[str]) -> list[tuple[str, str]]:
    """Yield (transform_name, transformed_url) pairs for a given order.

    Skips transforms that return None (not applicable) and deduplicates
    URLs (so `original` and `drop_www` of `https://example.com` don't double-run).
    """
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for name in order:
        new_url = apply_transform(name, url)
        if new_url is None:
            continue
        if new_url in seen:
            continue
        seen.add(new_url)
        out.append((name, new_url))
    return out
