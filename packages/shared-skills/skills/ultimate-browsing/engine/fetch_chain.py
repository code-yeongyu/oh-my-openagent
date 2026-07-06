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

from .curl_probe import run_attempt
from .result_schema import Attempt, FetchResult
from .summary import format_summary
from .validators import Verdict
from .waf_detector import DetectionHit, detect, load_profile, _load_profiles, last_load_error
from .url_transforms import iter_transformed


# --- Main entrypoint ---------------------------------------------------------
def fetch(
    url: str,
    *,
    success_selectors: list[str] | None = None,
    device_class: str = "auto",      # "auto" | "desktop" | "mobile"
    user_hint: dict | None = None,
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
    last_attempt: Attempt | None = None
    profile_used: str | None = None

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

    probe_attempt, probe_resp = run_attempt(
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
        hits = [DetectionHit(profile_id="unknown_challenge", confidence=0.1, signals=["no_probe_response"])]

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
                    att, resp = run_attempt(
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
        except (RuntimeError, OSError) as e:
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
    summary = format_summary(trace, profile_used)
    return FetchResult(
        ok=False,
        content=getattr(last_resp, "text", "") if last_resp is not None else "",
        final_url=getattr(last_resp, "url", url) if last_resp is not None else url,
        verdict=last_attempt.verdict if last_attempt else Verdict.UNKNOWN.value,
        profile_used=profile_used,
        trace=trace,
        summary=summary,
    )


def _build_result(resp, attempt: Attempt, trace: list[Attempt], profile_used: str | None) -> FetchResult:
    return FetchResult(
        ok=True,
        content=getattr(resp, "text", "") or "",
        final_url=str(getattr(resp, "url", attempt.url)),
        verdict=attempt.verdict,
        profile_used=profile_used,
        trace=trace,
        summary=f"{attempt.executor} {attempt.impersonate} + {attempt.url_transform} + referer:{attempt.referer} → {attempt.verdict}",
    )
