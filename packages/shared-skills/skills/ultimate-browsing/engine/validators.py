"""Generic challenge / success validator.

Four layers (all generic, never site-specific):
  1. Challenge markers (WAF product strings — not site brand names)
  2. Size fingerprints (known bad byte sizes hinted by caller)
  3. Cookie sensor state (e.g. Akamai `_abck=~-1~`)
  4. Caller-supplied success_selectors (strongest positive proof)

Layers 1-3 are "negative proof" (fail fast).
Layer 4 is "positive proof" — without it, HTTP 200 is only a weak success.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

try:
    from bs4 import BeautifulSoup
except ImportError:  # bs4 is a soft dep: only used when selectors given
    BeautifulSoup = None  # type: ignore


# Markers are WAF-product strings only. Never include site brand / domain.
CHALLENGE_MARKERS: list[str] = [
    "Access Denied",
    "sec-if-cpt-container",
    "Powered and protected by Akamai",
    "Just a moment...",
    "Checking your browser",
    "cf-chl-bypass",
    "Attention Required! | Cloudflare",
    "<title>Bot Challenge</title>",
    "DataDome",
    "captcha",
    "Please enable JS and disable any ad blocker",
    "The requested URL was rejected",
    "Request unsuccessful. Incapsula",
]

# Minimum body size below which we suspect a stub / challenge page.
# Tunable: some legitimate short JSON responses may be smaller, but callers
# that know their response type should pass success_selectors instead.
SMALL_BODY_THRESHOLD = 3000


class Verdict(Enum):
    """Three-level classification (Codex suggestion — avoid binary)."""

    STRONG_OK = "strong_ok"      # passes all layers incl. success_selectors
    WEAK_OK = "weak_ok"          # passes 1-3 but no positive proof available
    CHALLENGE = "challenge"      # fails 1-3 (negative proof triggered)
    BLOCKED = "blocked"          # non-200 status
    UNKNOWN = "unknown"          # exception / malformed response


@dataclass
class ValidationResult:
    verdict: Verdict
    reasons: list[str] = field(default_factory=list)
    matched_selectors: list[str] = field(default_factory=list)
    body_size: int = 0
    status: int = 0

    @property
    def ok(self) -> bool:
        """Kept for ergonomic `if vr.ok:` use — weak_ok counts as ok."""
        return self.verdict in (Verdict.STRONG_OK, Verdict.WEAK_OK)

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict.value,
            "reasons": self.reasons,
            "matched_selectors": self.matched_selectors,
            "body_size": self.body_size,
            "status": self.status,
        }


def _marker_hits(body_lower: str) -> list[str]:
    return [m for m in CHALLENGE_MARKERS if m.lower() in body_lower]


def _abck_unresolved(cookies: dict) -> bool:
    abck = cookies.get("_abck", "")
    return bool(abck) and "~-1~" in abck


def _selector_hits(body: str, selectors: list[str]) -> Optional[list[str]]:
    """Return matched-selector list, or None if BS4 is unavailable.

    Distinguishing None (dependency missing) from [] (nothing matched) lets
    the caller classify as UNKNOWN vs CHALLENGE correctly (Codex review: do
    not let dependency failure masquerade as a WAF outcome).
    """
    if BeautifulSoup is None:
        return None
    try:
        soup = BeautifulSoup(body, "html.parser")
    except Exception:
        return []
    hits: list[str] = []
    for sel in selectors:
        try:
            if soup.select(sel):
                hits.append(sel)
        except Exception:
            continue
    return hits


def validate(
    resp,
    *,
    success_selectors: Optional[list[str]] = None,
    known_bad_sizes: Optional[list[int]] = None,
    size_tolerance: int = 20,
) -> ValidationResult:
    """Validate a `curl_cffi` / `requests` response.

    Parameters
    ----------
    resp
        Response object with `.status_code`, `.text`, and cookie-like access.
    success_selectors
        Caller-supplied CSS selectors. Any match promotes `weak_ok` → `strong_ok`.
        Absence of selectors still allows `weak_ok` (no positive proof, but
        no negative proof either).
    known_bad_sizes
        Byte sizes that have been empirically observed as challenge-page
        fingerprints (caller / profile hint). NOTE: these values decay over
        time — profiles should timestamp or refresh them.
    """
    try:
        status = int(getattr(resp, "status_code", 0) or 0)
        text = getattr(resp, "text", "") or ""
        size = len(text)
    except Exception as e:
        return ValidationResult(verdict=Verdict.UNKNOWN, reasons=[f"parse_error:{e}"])

    r = ValidationResult(verdict=Verdict.UNKNOWN, body_size=size, status=status)

    if status == 0 or status >= 400:
        r.verdict = Verdict.BLOCKED
        r.reasons.append(f"status={status}")
        return r

    # --- Layer 1: challenge markers (product strings, never site brand) ---
    lowered = text.lower()
    markers = _marker_hits(lowered)
    if markers:
        r.verdict = Verdict.CHALLENGE
        r.reasons.extend(f"marker:{m}" for m in markers[:3])
        return r

    # --- Layer 2: size fingerprints (caller hint, tolerant match) ---
    # Fingerprint match is a strong negative signal — override even selectors.
    if known_bad_sizes:
        for bad in known_bad_sizes:
            if abs(size - bad) <= size_tolerance:
                r.verdict = Verdict.CHALLENGE
                r.reasons.append(f"size_fp:{size}~{bad}")
                return r

    # --- Layer 4 (early): caller's positive proof overrides size heuristic ---
    # If caller provided selectors, trust their definition of "content exists".
    # A small page with the required selector is still success.
    if success_selectors:
        hits = _selector_hits(text, success_selectors)
        if hits is None:
            # BS4 dependency missing — can't evaluate caller's proof.
            # Classify as UNKNOWN (not CHALLENGE) so a WAF outcome isn't faked.
            r.verdict = Verdict.UNKNOWN
            r.reasons.append("bs4_missing")
            return r
        if hits:
            # Cookie sensor state acts as a true gate when selectors passed:
            # unresolved `_abck` means Akamai did not accept our session even
            # though the body has our expected selector — trust is weak.
            cookies = _extract_cookies(resp)
            r.matched_selectors = hits
            if _abck_unresolved(cookies):
                r.reasons.append("abck_unresolved")
                r.verdict = Verdict.WEAK_OK  # demoted from STRONG_OK
                return r
            r.verdict = Verdict.STRONG_OK
            return r
        # Selectors requested but none matched → challenge regardless of size.
        r.verdict = Verdict.CHALLENGE
        r.reasons.append("no_success_selector")
        return r

    # No selectors: fall back to size heuristic.
    if size < SMALL_BODY_THRESHOLD:
        r.verdict = Verdict.CHALLENGE
        r.reasons.append(f"tiny_body:{size}")
        return r

    # --- Layer 3: cookie sensor state (only when no selectors to decide on) ---
    cookies = _extract_cookies(resp)
    if _abck_unresolved(cookies):
        r.reasons.append("abck_unresolved")

    # No positive proof available — weak OK.
    r.verdict = Verdict.WEAK_OK
    return r


def _extract_cookies(resp) -> dict:
    try:
        return {c.name: c.value for c in resp.cookies.jar}
    except Exception:
        try:
            return dict(resp.cookies) if hasattr(resp, "cookies") else {}
        except Exception:
            return {}
