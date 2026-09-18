from __future__ import annotations

from typing import Optional

from .result_schema import Attempt
from .validators import Verdict


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


def format_summary(trace: list[Attempt], profile: Optional[str]) -> str:
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
