"""Single entrypoint: insane-search generic fetch chain.

    from insane_search.engine import fetch
    result = fetch("https://example.com/path", success_selectors=["article"])

Public contract:
  * One function: `fetch(url, ...) -> FetchResult`.
  * Internal structure preserved as explicit phases so tests & debug logs
    can target each stage: probe → validate → detect → plan → execute → report.
  * `FetchResult.trace` exposes every attempt (transform × impersonate ×
    referer × executor) — callers can diagnose without re-running.

No site-specific branching. Site knowledge enters only via:
  * `success_selectors` (caller-supplied positive proof)
  * `user_hint` (optional runtime hints; never persisted by this module)
  * `observations/*.jsonl` (append-only log; separate concern)
"""
from __future__ import annotations

import json
import os
import random
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Optional

from .validators import Verdict, ValidationResult, validate
from .waf_detector import detect, load_profile, _load_profiles, last_load_error
from .url_transforms import iter_transformed


# --- Referer strategies (name → function of original URL) --------------------
def _self_root(url: str) -> str:
    from urllib.parse import urlsplit
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}/"


REFERER_STRATEGIES = {
    "self_root": _self_root,
    "google_search": lambda _url: "https://www.google.com/",
    "none": lambda _url: "",
}


# --- Attempt & result schema (Codex: "evidence schema first") ----------------
@dataclass
class Attempt:
    phase: str                       # probe | grid | fallback
    executor: str                    # curl_cffi | playwright_mcp | playwright_real_chrome | ...
    url: str
    url_transform: str               # original | mobile_subdomain | ...
    impersonate: Optional[str]       # safari | chrome | ... | None (non-curl)
    referer: str
    status: int = 0
    body_size: int = 0
    verdict: str = ""
    reasons: list[str] = field(default_factory=list)
    elapsed_s: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FetchResult:
    ok: bool
    content: str = ""
    final_url: str = ""
    verdict: str = ""
    profile_used: Optional[str] = None
    trace: list[Attempt] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "final_url": self.final_url,
            "verdict": self.verdict,
            "profile_used": self.profile_used,
            "trace": [a.to_dict() for a in self.trace],
            "summary": self.summary,
            "content_length": len(self.content),
        }


# --- curl_cffi probe executor ------------------------------------------------
def _curl_probe(
    url: str, *, impersonate: str, referer: str, timeout: int = 20
) -> tuple[Any, Optional[str]]:
    """Returns (response, error_str). response may be None on exception."""
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
    except Exception as e:
        return None, f"{type(e).__name__}:{str(e)[:200]}"


def _run_attempt(
    url: str,
    *,
    transform_name: str,
    impersonate: str,
    referer_name: str,
    success_selectors: Optional[list[str]],
    known_bad_sizes: Optional[list[int]],
    timeout: int,
    phase: str,
) -> tuple[Attempt, Any]:
    """Execute one curl_cffi attempt and produce an Attempt record."""
    referer_url = REFERER_STRATEGIES.get(referer_name, REFERER_STRATEGIES["none"])(url)
    t0 = time.time()
    resp, err = _curl_probe(url, impersonate=impersonate, referer=referer_url, timeout=timeout)
    elapsed = round(time.time() - t0, 3)

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


# --- Main entrypoint ---------------------------------------------------------
def fetch(
    url: str,
    *,
    success_selectors: Optional[list[str]] = None,
    device_class: str = "auto",      # "auto" | "desktop" | "mobile"
    user_hint: Optional[dict] = None,
    timeout: int = 25,
    max_attempts: int = 12,
    enable_playwright: bool = True,   # hook left for executor module
) -> FetchResult:
    """Fetch `url` using the generic grid.

    Parameters
    ----------
    success_selectors
        Positive-proof CSS selectors. Presence of ≥1 match promotes verdict
        to STRONG_OK. Without them, best outcome is WEAK_OK.
    device_class
        "desktop" pins curl impersonate to desktop targets (safari/chrome/firefox).
        "mobile" pins to mobile targets (safari_ios/chrome_android) AND enables
        mobile URL transforms.
        "auto" (default) follows profile advice; tries desktop first, mobile on
        persistent failure.
    user_hint
        Optional runtime hints, e.g. `{"impersonate_first": "safari", "referer": "..."}`.
        Never stored. Only influences current call.
    timeout
        Per-attempt timeout in seconds.
    max_attempts
        Hard upper bound on total attempts across all phases.
    enable_playwright
        Placeholder — Playwright fallback invocation is delegated to
        `engine/executor.py` (separate module, capability-matched).
    """
    user_hint = user_hint or {}
    profiles = _load_profiles()
    trace: list[Attempt] = []
    last_resp = None
    last_attempt: Optional[Attempt] = None
    profile_used: Optional[str] = None

    # Surface profile-loader failures as a trace entry so callers can see
    # that we're running on the in-code default (YAML missing / invalid /
    # PyYAML not installed). Never fatal by itself.
    load_err = last_load_error()
    if load_err:
        trace.append(Attempt(
            phase="probe",
            executor="profile_loader",
            url=url,
            url_transform="original",
            impersonate=None,
            referer="",
            verdict=Verdict.UNKNOWN.value,
            error=f"profiles_fallback: {load_err}",
        ))

    # -------- Phase 1: probe with safe defaults ------------------------------
    base_impersonate = user_hint.get("impersonate_first") or "safari"
    if device_class == "mobile":
        base_impersonate = user_hint.get("impersonate_first") or "safari_ios"

    probe_attempt, probe_resp = _run_attempt(
        url,
        transform_name="original",
        impersonate=base_impersonate,
        referer_name=user_hint.get("referer_strategy") or "self_root",
        success_selectors=success_selectors,
        known_bad_sizes=None,
        timeout=timeout,
        phase="probe",
    )
    trace.append(probe_attempt)
    if probe_resp is not None:
        last_resp = probe_resp
        last_attempt = probe_attempt
        if probe_attempt.verdict in (Verdict.STRONG_OK.value, Verdict.WEAK_OK.value):
            return _build_result(probe_resp, probe_attempt, trace, profile_used=None)

    # -------- Phase 2: detect WAF, plan grid ---------------------------------
    if last_resp is not None:
        hits = detect(last_resp, profiles=profiles)
    else:
        hits = [type("H", (), {"profile_id": "unknown_challenge", "confidence": 0.1, "signals": ["no_probe_response"]})()]  # type: ignore

    # Try top profiles by confidence.
    attempts_used = len(trace)
    for hit in hits[:3]:  # top 3 candidates
        if attempts_used >= max_attempts:
            break
        profile_id = hit.profile_id
        profile_used = profile_id
        profile = load_profile(profile_id, profiles=profiles)

        tls_groups: list[list[str]] = profile.get("tls_impersonate_candidates") or [["safari", "chrome"]]
        tls_flat: list[str] = [t for group in tls_groups for t in group]
        avoid = set((profile.get("tls_impersonate_avoid") or []))
        tls_flat = [t for t in tls_flat if t not in avoid]

        referer_order = profile.get("referer_strategies") or ["self_root"]
        transform_order = profile.get("url_transform_order") or ["original"]

        # device_class override
        if device_class == "mobile":
            tls_flat = [t for t in tls_flat if "ios" in t or "android" in t] or tls_flat
            if "mobile_subdomain" not in transform_order:
                transform_order = transform_order + ["mobile_subdomain"]
        elif device_class == "desktop":
            tls_flat = [t for t in tls_flat if "ios" not in t and "android" not in t] or tls_flat

        known_bad_sizes = profile.get("known_bad_sizes") or None

        for t_name, t_url in iter_transformed(url, transform_order):
            for tls in tls_flat:
                for ref in referer_order:
                    if attempts_used >= max_attempts:
                        break
                    # Skip exact duplicate of probe.
                    if (t_name == "original" and tls == base_impersonate
                            and ref == (user_hint.get("referer_strategy") or "self_root")):
                        continue
                    att, resp = _run_attempt(
                        t_url,
                        transform_name=t_name,
                        impersonate=tls,
                        referer_name=ref,
                        success_selectors=success_selectors,
                        known_bad_sizes=known_bad_sizes,
                        timeout=timeout,
                        phase="grid",
                    )
                    trace.append(att)
                    attempts_used += 1
                    # Jitter: politeness + IP-reputation guard. Tunable via
                    # INSANE_JITTER_MS_MIN / INSANE_JITTER_MS_MAX env vars.
                    _jmin = int(os.environ.get("INSANE_JITTER_MS_MIN", "150"))
                    _jmax = int(os.environ.get("INSANE_JITTER_MS_MAX", "400"))
                    time.sleep(random.uniform(_jmin/1000.0, _jmax/1000.0))
                    if resp is None:
                        continue
                    last_resp, last_attempt = resp, att
                    if att.verdict in (Verdict.STRONG_OK.value, Verdict.WEAK_OK.value):
                        return _build_result(resp, att, trace, profile_used=profile_id)

    # -------- Phase 3: Playwright fallback (profile-driven order) -----------
    if enable_playwright:
        try:
            from .executor import run_playwright_fallback  # lazy import
            # Honour profile's `fallback_when_challenge` list — iterate the
            # caller-declared order instead of capability-inferred single pick.
            fb_profile = load_profile(profile_used or "unknown_challenge", profiles=profiles)
            fb_order = fb_profile.get("fallback_when_challenge") or ["playwright_real_chrome"]
            pw_attempt = None
            pw_content = ""
            for fb_name in fb_order:
                if fb_name == "curl_grid_exhaust":
                    # Already performed in Phase 2; nothing more to do here.
                    continue
                pw_attempt, pw_content = run_playwright_fallback(
                    url,
                    profile_id=profile_used or "unknown_challenge",
                    success_selectors=success_selectors,
                    device_class=device_class,
                    force_executor=fb_name,
                )
                trace.append(pw_attempt)
                if pw_attempt.verdict in (Verdict.STRONG_OK.value, Verdict.WEAK_OK.value):
                    return FetchResult(
                        ok=True,
                        content=pw_content,
                        final_url=pw_attempt.url,
                        verdict=pw_attempt.verdict,
                        profile_used=profile_used,
                        trace=trace,
                        summary=f"Playwright fallback succeeded via {fb_name}",
                    )
            # Synthesize a placeholder if no iteration ran (empty list).
            if pw_attempt is None:
                pw_attempt = Attempt(
                    phase="fallback",
                    executor="none",
                    url=url,
                    url_transform="original",
                    impersonate=None,
                    referer="",
                    verdict=Verdict.UNKNOWN.value,
                    error="profile has empty fallback_when_challenge",
                )
                trace.append(pw_attempt)
        except ImportError:
            trace.append(Attempt(
                phase="fallback",
                executor="playwright",
                url=url,
                url_transform="original",
                impersonate=None,
                referer="",
                verdict=Verdict.UNKNOWN.value,
                error="executor module not available",
            ))
        except Exception as e:
            trace.append(Attempt(
                phase="fallback",
                executor="playwright",
                url=url,
                url_transform="original",
                impersonate=None,
                referer="",
                verdict=Verdict.UNKNOWN.value,
                error=f"{type(e).__name__}:{str(e)[:200]}",
            ))

    # -------- Give up, return best we have ----------------------------------
    summary = _format_summary(trace, profile_used)
    return FetchResult(
        ok=False,
        content=getattr(last_resp, "text", "") if last_resp is not None else "",
        final_url=getattr(last_resp, "url", url) if last_resp is not None else url,
        verdict=last_attempt.verdict if last_attempt else Verdict.UNKNOWN.value,
        profile_used=profile_used,
        trace=trace,
        summary=summary,
    )


def _build_result(resp, attempt: Attempt, trace: list[Attempt], profile_used: Optional[str]) -> FetchResult:
    return FetchResult(
        ok=True,
        content=getattr(resp, "text", "") or "",
        final_url=str(getattr(resp, "url", attempt.url)),
        verdict=attempt.verdict,
        profile_used=profile_used,
        trace=trace,
        summary=f"{attempt.executor} {attempt.impersonate} + {attempt.url_transform} + referer:{attempt.referer} → {attempt.verdict}",
    )


# WAF profiles known to typically gate HTML but leave internal JSON APIs
# (relatively) open. When these are detected and curl challenges pile up,
# we surface R7 hint in the summary so the caller (or Claude) can branch
# to an API-first route without waiting for full grid exhaustion.
_R7_ELIGIBLE_PROFILES = frozenset({
    "akamai_bot_manager",
    "cloudflare_turnstile",
    "datadome_probable",
    "perimeterx_human",
    "f5_big_ip",
    "aws_waf",
})

R7_HINT = (
    "💡 R7 API-first 권장: WAF가 HTML 경로를 차단 중. "
    "Playwright MCP 사용 → browser_navigate → browser_network_requests "
    "→ `/api/`·`/graphql`·`\\.json` 필터로 내부 엔드포인트 탐지 → "
    "해당 URL을 `python3 -m engine <API_URL>`로 재호출. 대부분 API 레이어는 "
    "WAF 방어가 얕아 curl_cffi만으로 수집됨."
)


def _format_summary(trace: list[Attempt], profile: Optional[str]) -> str:
    n = len(trace)
    verdicts = [a.verdict for a in trace]
    challenge_count = sum(1 for v in verdicts if v == Verdict.CHALLENGE.value)
    base = (
        f"failed after {n} attempts; profile={profile}; "
        f"verdicts={','.join(v for v in verdicts[:5])}" + ("..." if n > 5 else "")
    )
    if profile in _R7_ELIGIBLE_PROFILES and challenge_count >= 3:
        return base + "\n" + R7_HINT
    return base
