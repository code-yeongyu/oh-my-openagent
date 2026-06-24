from __future__ import annotations

import time
from typing import Iterable, Mapping, Protocol

from .referers import REFERER_STRATEGIES
from .result_schema import Attempt
from .validators import Verdict, validate


class _CookieItem(Protocol):
    name: str
    value: str


class _CookieJar(Protocol):
    jar: Iterable[_CookieItem]


class ProbeResponse(Protocol):
    status_code: int
    text: str
    url: str
    cookies: _CookieJar | Mapping[str, str]


def _curl_probe(
    url: str, *, impersonate: str, referer: str, timeout: int = 20
) -> tuple[ProbeResponse | None, str | None]:
    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        return None, "curl_cffi not installed"

    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    if referer:
        headers["Referer"] = referer

    try:
        resp = cffi_requests.get(
            url,
            impersonate=impersonate,
            headers=headers,
            timeout=timeout,
            allow_redirects=True,
        )
        return resp, None
    except cffi_requests.exceptions.RequestException as e:
        return None, f"{type(e).__name__}:{str(e)[:200]}"


def run_attempt(
    url: str,
    *,
    transform_name: str,
    impersonate: str,
    referer_name: str,
    success_selectors: list[str] | None,
    known_bad_sizes: list[int] | None,
    timeout: int,
    phase: str,
) -> tuple[Attempt, ProbeResponse | None]:
    referer_url = REFERER_STRATEGIES.get(referer_name, REFERER_STRATEGIES["none"])(url)
    started_at = time.time()
    resp, err = _curl_probe(url, impersonate=impersonate, referer=referer_url, timeout=timeout)
    elapsed = round(time.time() - started_at, 3)

    att = Attempt(
        phase=phase,
        executor="curl_cffi",
        url=url,
        url_transform=transform_name,
        impersonate=impersonate,
        referer=referer_name,
        elapsed_s=elapsed,
    )

    if err or resp is None:
        att.error = err or "no response"
        att.verdict = Verdict.UNKNOWN.value
        return att, None

    vr = validate(resp, success_selectors=success_selectors, known_bad_sizes=known_bad_sizes)
    att.status = vr.status
    att.body_size = vr.body_size
    att.verdict = vr.verdict.value
    att.reasons = vr.reasons
    return att, resp
