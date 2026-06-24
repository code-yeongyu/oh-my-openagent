# 접근 실패 시 — 적응형 스케줄러

> 인덱스 방법이 실패하거나 인덱스에 없는 사이트일 때 실행.
> Phase 0 → 1 → 2 → 3 순서로 에스컬레이션. 각 Phase에서 성공하면 즉시 종료.

## 원칙

1. **어떤 방법도 미리 제외하지 않는다** — 되는지는 시도해봐야 안다
2. **의존성이 없으면 설치하고 시도한다** — 미설치를 이유로 건너뛰지 않는다
3. **Phase 간 전환은 신호 기반** — 실패 유형에 따라 에스컬레이션
4. **결과 채택 기준**: 정확성/신뢰도 > 신선도 > 완전성 > 구조화 > 비용

---

## Phase 0: 특수 엔드포인트 (인덱스 매칭)

인덱스에 사이트가 있으면 해당 전용 방법을 **먼저** 시도.
정확성과 비용이 가장 좋으므로 generic Phase 1보다 우선.

성공 → 종료 / 실패 → Phase 1

---

## Phase 1: 경량 프로브 (병렬)

**먼저 시도** (동시):
- WebFetch (Claude 내장)
- Jina Reader (기본 / JSON / SPA 모드)
- curl Chrome Desktop UA

**아직 성공 없으면 추가 시도**:
- curl 모바일 UA + 모바일 URL (`m.{domain}`)
- curl Googlebot UA
- URL 변형 시도: `.json`, `/rss`, `/feed`

**사이드카** (1차와 동시, low-trust):
- Google AMP 캐시
- archive.today
- Wayback Machine
→ **원본이 하나라도 성공하면 사이드카는 참고만.** 전부 실패 시에만 사이드카 채택 (provenance 태깅 필수)

**모든 응답에서 메타데이터도 추출**: OGP, JSON-LD — [metadata.md](metadata.md) 참조

상세: [jina.md](jina.md), [cache-archive.md](cache-archive.md), [rss.md](rss.md)

---

## 에스컬레이션 신호

Phase 1 → Phase 2 전환 조건:

| 신호 | 감지 방법 | 의미 |
|------|-----------|------|
| HTTP 403/430 | 상태 코드 | WAF/봇 차단 |
| HTTP 429/503 | 상태 코드 | Rate limit (짧은 jitter retry 먼저, 실패 시 에스컬레이션) |
| WAF 헤더 | `cf-ray`, `server: cloudflare`, `x-datadome` | Cloudflare/Akamai/DataDome |
| WAF 쿠키 | `__cf_bm`, `_abck`, `datadome` | WAF 세션 |
| 챌린지 본문 | `captcha`, `verify`, `enable javascript`, `check your browser` | JS 챌린지 |
| 빈 SPA | `<div id="root"></div>` 외 콘텐츠 없음, 200자 미만 | JS 렌더링 필요 |
| Redirect loop | 3회 이상 302/307 | 챌린지 리다이렉트 |

**login/paywall 감지 시**: `login`, `sign in`, `로그인`, `subscribe`, `구독` 집중 → Phase 2/3으로 올려도 해결 안 됨. **"인증 필요"로 종료.**

---

## Phase 2: TLS 임퍼소네이션 (curl_cffi)

**조건**: Phase 1에서 WAF/봇 차단 신호 감지

**의존성 확보**:
```bash
python3 -c "import curl_cffi" 2>/dev/null || pip install curl_cffi -q
```
설치 실패 시 → 즉시 Phase 3으로.

**다중 타겟 순차 시도**: safari → chrome → firefox

```python
from curl_cffi import requests

TARGETS = ["safari", "chrome", "firefox"]
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.google.com/",
}

for target in TARGETS:
    try:
        session = requests.Session(impersonate=target)
        session.headers.update(HEADERS)
        resp = session.get("{URL}", timeout=20)
        if resp.status_code == 200 and len(resp.text) > 300:
            # 성공 — JSON-LD도 같이 추출
            break
    except:
        continue
```

성공 → 종료 / 실패 또는 JS 챌린지 → Phase 3

상세: [tls-impersonate.md](tls-impersonate.md)

---

## Phase 3: Playwright MCP (브라우저)

**조건**: Phase 2도 실패 또는 JS 챌린지/CAPTCHA 감지

```
browser_navigate → {URL}
browser_wait_for → "body" (3초)
browser_evaluate → () => document.body.innerText  (Light Mode — 먼저)
필요 시 browser_snapshot → 접근성 트리 전체
```

**API 발견**: `browser_network_requests`로 숨은 JSON API를 찾으면 이후 curl_cffi로 재사용 가능.

상세: [playwright.md](playwright.md)

---

## 응답 검증

| 판정 | 조건 | 결과 |
|------|------|------|
| **성공** | 콘텐츠 타입에 맞는 분량 + 주제 관련 키워드 | 채택 |
| **부분 성공** | OG 메타/JSON-LD만 (본문 없음) | 보조 소스 |
| **실패 — 인증** | login/paywall 감지 | "인증 필요"로 종료 |
| **실패 — 챌린지** | CAPTCHA/JS challenge | 다음 Phase로 |
| **실패 — 에러** | 4xx/5xx | 다음 Phase로 |
| **실패 — 빈 SPA** | 콘텐츠 없음 | 다음 Phase로 |

**콘텐츠 분량 기준** (유연하게):
- 기사/블로그: 500자 이상
- 상품 페이지: JSON-LD 있으면 성공
- 트윗/짧은 글: 100자 이상
- 프로필: JSON-LD Person 있으면 성공

## False-Positive 마커 (HTTP 200이지만 실패)

| 패턴 | 감지 방법 | 처리 |
|------|----------|------|
| X SPA 셸 (247KB) | 200 OK + `Sign in to X` 또는 `hasResults: false` | 실패 — WebSearch+oEmbed 폴백 |
| CAPTCHA 페이지 | 200 OK + `captcha\|recaptcha\|hcaptcha\|cf-turnstile` | 실패 — 다음 Phase |
| 소프트 페이월 | 200 OK + `member-only\|subscribe to read\|구독하세요` | 부분 성공 — 메타만 채택 |
| DDG 소프트 리밋 | 202 Accepted + body 15KB 미만 | 실패 — 다른 엔진 폴백 |
| 빈 JSON | 200 OK + `hasResults.*false\|"entries":\s*\[\]` | 실패 — 다른 방법 시도 |
| 지역 차단 | 200 OK + `not available in your region\|geo-restricted` | 실패 — "지역 차단" 알림 |
| WAF 소프트 블록 | 200 OK + `checking your browser\|verify you are human` | 실패 — Phase 2/3 에스컬레이션 |
| Akamai behavioral | 200 OK + `behavioral-content\|sec-if-cpt` + `_abck` 쿠키 | 실패 — JS 실행 필수 → Phase 3 직행 (TLS 타겟 변경 무의미) |
| RSS Content-Type 오류 | RSS 기대 + `text/html` 응답 | 실패 — "RSS 미지원" |
| 에러 JSON | 200 OK + JSON `"error"` 키 존재 | 실패 — 에러 내용 로깅 |

## 전부 실패 시

1. 시도한 Phase와 각 실패 신호를 기록
2. 사이드카 결과가 있으면 provenance 태깅하여 채택
3. 사이드카도 없으면 사용자에게 실패 보고 + 시도 결과 공유
