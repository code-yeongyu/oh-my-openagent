
# Insane Search

> Part of the **ultimate-browsing** skill (Tier 1). Routing and tier-escalation live in [../../SKILL.md](../../SKILL.md).
> The engine package it drives is at [../../engine/](../../engine/), invoked from the skill directory as `python3 -m engine "<URL>"`.
> Deep-dives in this folder: TLS impersonation, Playwright routing, fallback, metadata, Jina, cache/archive, RSS, JSON/public APIs, Twitter, Naver, media.


> URL 접근이 차단될 때, **사이트 무관한** 대체 접근 전략을 자동 선택한다.

## 하네스 규칙 (Claude에게 강제되는 지침)

이 규칙은 Claude가 즉흥 판단으로 엇나가지 못하게 하기 위한 **고삐**다. 위반 시 이전 test.md 세션처럼 "chrome 200에서 break → safari 미시도 → Playwright 미설치라 포기" 식의 오판이 재현된다.

**R1 — 일반 웹 URL 차단/403/402 감지 시**:
1. WebFetch, 즉흥 curl, 수동 헤더 조합 **시도 금지**
2. 즉시 다음을 실행:
   ```bash
   python3 -m engine "<URL>" [--selector "<CSS>"] [--device auto|desktop|mobile] [--trace]
   ```
3. 종료코드 0(ok) 또는 1(fail) 받은 뒤 판단. trace를 먼저 읽고 재시도 결정.
4. 실패 시에만 `--trace --json`으로 재호출해서 원인 진단 후 `--device` 또는 `user_hint` 조정.

**R2 — 첫 200에서 탈출 금지**: HTTP 200은 **검사 시작 조건**이지 성공이 아니다. `validate()`의 4-계층 검증을 통과해야 성공 선언. CLI는 이미 강제한다.

**R3 — 편향 금지**: `engine/**`, `waf_profiles.yaml`에 특정 사이트 도메인·셀렉터·브랜드명 하드코딩 금지. `python3 engine/bias_check.py`가 CI 게이트. 자세한 규칙은 **No-Site-Name Rule** 섹션.

**R4 — 힌트는 런타임에만**: 사이트 고유 정보(성공 셀렉터, 우선 Referer)는 CLI 인자 또는 `user_hint`로만 전달, 저장소에 고정 금지.

**R5 — Phase 0 공식 API 우선**: X/Reddit/YouTube/HN/arXiv 등 **공식 공개 엔드포인트**가 있는 플랫폼은 Phase 0 테이블을 먼저 확인하고 해당 API를 쓴다. 이건 편향이 아니라 합의된 접근 경로.

**R6 — 실패 선언은 전수 시도 후에만**: 격자(URL 변환 × TLS impersonate × Referer × Playwright fallback)를 **모두** 돌린 뒤에만 "뚫을 수 없음" 결론. CLI의 `max_attempts` 기본 12가 이를 보장.
단, R7 조건(WAF 조기 감지)이 성립하면 engine 격자는 계속 돌되, Claude가 **병렬로** MCP 정찰 루트를 시도할 수 있다. 빠른 쪽이 이긴다.

**R7 — WAF 조기 감지 시 API-first 병행 분기** (분기 결정은 자동이지만 사용자가 결과에서 확인 가능 — 어떤 접근 경로로 성공/실패했는지 결과 metadata에 명시):
발동 조건 (AND):
1. engine 실행 초기에 첫 2~3회 attempt가 모두 `verdict=challenge`
2. `profile_used`가 `akamai_bot_manager`, `cloudflare_turnstile`, `datadome_probable`, `perimeterx_human`, `f5_big_ip`, `aws_waf` 중 하나로 확정
3. **사용자 요청이 리스트/수집/반복 의도** (여러 페이지, N개 이상, "전부", "크롤링", 페이지네이션 등). 단건 본문 조회는 해당 없음.

세 조건 모두 참일 때 Claude는 **병렬 경로**를 시작한다:

**"병렬"의 실행 의미** (Claude 도구 호출이 순차이므로 명확화):
- engine은 `run_in_background=true`로 Bash 툴에서 띄워둔다 — 격자는 그대로 돌되 블로킹하지 않음
- Claude는 그 사이 foreground에서 MCP Playwright 정찰 루트를 진행
- engine이 먼저 성공해도 좋고, MCP 정찰로 얻은 API가 먼저 성공해도 좋음. 빠른 쪽 결과 채택

**MCP 정찰 루트**:
1. `mcp__playwright__browser_navigate` → 대상 페이지 로드 (브라우저 렌더링)
2. `mcp__playwright__browser_network_requests` → XHR/fetch 호출 목록 수집, `/api/`·`/graphql`·`\.json` 필터로 내부 엔드포인트 식별
3. 식별된 JSON API URL을 `python3 -m engine <API_URL>`로 재호출 (백그라운드 engine과는 별개 호출). 대부분 API 레이어는 페이지 HTML보다 WAF 보호가 얕아 curl_cffi로 바로 수집됨
4. 응답 스키마 파악 후 pagination / query parameter 조합해 반복 수집

**왜**: SPA + WAF 사이트(쇼핑몰·커머스 다수)는 마케팅 페이지(HTML)만 WAF로 중투자하고 내부 API는 gateway 레벨 기본 방어만 쓰는 경우가 많다. HTML 격자 전수 낭비(50회 × 0.5s + Playwright fallback 40s ≈ 65초)보다 **MCP 정찰 1회(5~10초) + API 재호출(0.5초)**가 훨씬 경제적이고 성공률 높음.

**R7을 쓰지 말아야 할 때**: 단일 페이지 본문 읽기만 필요한 단건 조회(문서 하나, 블로그 포스트 하나)는 engine만으로 충분하다 — 발동 조건 #3이 이를 배제한다.

**R7 편향 방지**: 내부 API URL·파라미터는 `engine/**`에 하드코딩 금지. 탐지된 URL은 런타임 호출에만 쓰고 저장소에 고정하지 않는다.

---

이 스킬의 핵심 불변식:

- **단일 진입점**: 일반 웹 페이지는 항상 `python3 -m engine <URL>` 또는 `from engine import fetch; fetch(...)`.
- **편향 금지**: `engine/**`, `waf_profiles.yaml`에 특정 사이트 하드코딩 금지.
- **힌트는 런타임에만**: 사이트 고유 정보는 CLI/`user_hint` 경유.

## 의도 분류 (Phase 0 진입 전)

| 사용자 입력 | 경로 |
|------------|------|
| URL 제공 (`https://...`) | → Phase 0 검사 후 없으면 Phase 1 (generic fetch chain) |
| 핸들 제공 (`@username`) | → Phase 0 syndication/API |
| 키워드만 ("X에서 AI 검색") | → WebSearch(`site:{domain} {keyword}`) 먼저 → URL 확보 후 재진입 |

> **한국어 신규 콘텐츠 한계**: 네이버/다음/한국 커뮤니티의 키워드 검색은 WebSearch 경유가 유일하며, 신규 콘텐츠 인덱싱이 지연될 수 있다.

## Phase 0 — 플랫폼 공식 API 인덱스

> 플랫폼이 **공식 공개한** 전용 API/CLI만 여기에 둔다. 이건 편향이 아니라 합의된 엔드포인트 사용이다.

### 소셜/커뮤니티 전용 API

| 플랫폼 | 방법 | 상세 |
|--------|------|------|
| X/Twitter | syndication (타임라인) + oEmbed (개별 트윗) + 키워드 검색: WebSearch → oEmbed | [twitter.md](twitter.md) |
| Reddit | URL + `.json` + Mobile UA | [json-api.md](json-api.md) |
| Bluesky | AT Protocol (`public.api.bsky.app/xrpc/...`) | [public-api.md](public-api.md) |
| Mastodon | 인스턴스별 공개 API | [public-api.md](public-api.md) |
| Hacker News | Firebase API + Algolia Search | [json-api.md](json-api.md) |
| Stack Overflow | SE API v2.3 | [public-api.md](public-api.md) |
| Lobste.rs / V2EX / dev.to | 공개 JSON API | [json-api.md](json-api.md) |

### 미디어 (CLI 도구 필수)

| 플랫폼 | 방법 | 상세 |
|--------|------|------|
| YouTube/Vimeo/Twitch/TikTok/SoundCloud 등 1,858개 | `yt-dlp --dump-json` | [media.md](media.md) |

### 학술/레지스트리

| 플랫폼 | 방법 | 상세 |
|--------|------|------|
| arXiv | Atom API | [public-api.md](public-api.md) |
| CrossRef | REST API | [public-api.md](public-api.md) |
| Wikipedia | REST API | [json-api.md](json-api.md) |
| OpenLibrary | JSON API | [public-api.md](public-api.md) |
| GitHub | gh CLI / REST API | [public-api.md](public-api.md) |
| npm / PyPI | Registry API | [json-api.md](json-api.md) |
| Wayback Machine | CDX API | [public-api.md](public-api.md) |

### 한국 전용 공식 API

| 플랫폼 | 방법 | 상세 |
|--------|------|------|
| 네이버 검색 | `search.naver.com` (통합/블로그/뉴스탭) | [naver.md](naver.md) |
| 네이버 금융 시세 | `api.finance.naver.com/siseJson.naver` (비공식 JSON) | [naver.md](naver.md) |

**그 외 모든 사이트는 Phase 1(generic fetch chain)이 자동 처리한다.**

## Phase 1 — Generic Fetch Chain

### 단일 진입점

```python
from insane_search.engine import fetch

result = fetch(
    "https://example.com/path",
    success_selectors=["article", "[class*='product-card']"],  # 포지티브 프루프 (선택)
    device_class="auto",      # "auto" | "desktop" | "mobile"
    user_hint=None,           # {"referer_strategy": "self_root", "impersonate_first": "safari"}
    timeout=25,
)

if result.ok:
    print(result.verdict)     # strong_ok | weak_ok
    html = result.content
else:
    # Phase 3 수동 개입 (Playwright MCP) 필요 — result.trace로 원인 진단
    pass
```

### 내부 단계 (디버깅용 노출)

`fetch()`는 단일 API이지만 내부는 phase로 나뉘어 있다. `result.trace`에서 각 시도를 확인할 수 있다.

```
probe      — curl_cffi + safari + self-referer로 첫 시도
validate   — 4-계층 검증 (marker / size / cookie / success_selectors)
detect     — WAF 제품 감지 ([(profile_id, confidence)] 랭킹)
plan       — 프로파일의 tls_candidates × url_transforms × referer 격자 구성
execute    — 격자 전수 시도 (첫 200에서 탈출하지 않음)
fallback   — capability 태그 기반 Playwright 라우팅 (MCP or local+chrome)
report     — FetchResult(ok, verdict, profile_used, trace, summary)
```

### 검증 원칙

- HTTP 200은 **검사 시작 조건**이지 성공이 아니다.
- 성공 판정은 **4-계층 AND**:
  1. 챌린지 마커 없음 (`sec-if-cpt-container`, `Access Denied`, `Just a moment...`, `DataDome`)
  2. 비정상 크기 아님 (< 3KB 또는 WAF fingerprint 크기)
  3. 쿠키 센서 상태 정상 (`_abck=~-1~` 아님)
  4. `success_selectors` 중 하나 이상 매칭 (caller 제공 시 → `strong_ok`, 미제공 시 → `weak_ok`)

### 격자 축 (profile이 우선순위 추천, 격자는 전수 시도)

| 축 | 값 | 비고 |
|----|-----|------|
| `url_transforms` | `original`, `mobile_subdomain` (`www.→m.`), `am_prefix`, `drop_www` | 사이트명 없음, 규칙만 |
| `tls_impersonate` | `safari`, `safari_ios`, `chrome99`, `chrome119`, `chrome131`, `chrome_android`, `firefox`... | 프로파일별 avoid 리스트 존재 |
| `referer_strategy` | `self_root`, `google_search`, `none` | |

**device_class**:
- `"auto"` (기본) — 프로파일 전략 따름
- `"desktop"` — TLS 데스크톱만 + `mobile_subdomain` 비활성
- `"mobile"` — TLS 모바일만 + `mobile_subdomain` 활성

### Playwright 폴백 (capability-matched)

`engine/executor.py`가 프로파일의 `capabilities_needed`를 읽고 실행기를 자동 선택:

| 태그 | 실행기 | 언제 |
|------|--------|------|
| `needs_real_tls_stack` + `needs_js_exec` | `playwright_real_chrome.js` (로컬 Node) | Akamai Bot Manager 등 — Chromium 번들 TLS는 탐지됨 |
| `needs_js_exec` only | Playwright MCP (`mcp__playwright__*`) | Cloudflare 기본 방어 등 |
| `needs_mobile_context` (+ real_tls) | `playwright_mobile_chrome.js` | 모바일 디바이스 에뮬레이션 필요 |

자세한 선택 기준: [playwright.md](playwright.md).

### Playwright MCP 호출 규칙

`fetch_chain`의 `needs_js_exec only` 케이스는 **Claude 세션에서 MCP 도구를 직접 호출**해야 한다. subprocess 경로 없음. 즉:
1. `result.summary`에 "Playwright MCP must be invoked from the Claude session"이 포함되면
2. `mcp__playwright__browser_navigate` → `browser_wait_for` → `browser_snapshot` 흐름으로 Claude가 직접 처리

## Phase 2 — 수동 개입 (옵션)

Phase 1이 `ok=False`를 반환하면 사용자 힌트를 받아 재시도:

```python
result = fetch(
    url,
    success_selectors=[...],
    user_hint={"impersonate_first": "safari_ios", "referer_strategy": "none"},
)
```

힌트는 **현재 호출 1회에만** 적용되며 저장되지 않는다.

## 의존성 자동 설치

최초 호출 시 필요 패키지를 자동 설치한다:
```bash
python3 -c "import curl_cffi, bs4, yaml" 2>/dev/null || pip install curl_cffi beautifulsoup4 pyyaml -q
```

Playwright 로컬 경로 사용 시 Node가 필요:
```bash
npm i -g playwright playwright-extra puppeteer-extra-plugin-stealth
npx playwright install chrome
```

## 빠른 참조 — Phase 0 명령어

```bash
# 범용 웹 (Jina Reader — 일반 HTML만, WAF 사이트엔 무효)
curl -s "https://r.jina.ai/{URL}"

# yt-dlp — 1,858 사이트 미디어 메타데이터
yt-dlp --dump-json "URL"

# Reddit
curl -sL -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" \
  "https://www.reddit.com/r/{sub}/hot.json?limit=10"

# X/Twitter 타임라인
curl -sL "https://syndication.twitter.com/srv/timeline-profile/screen-name/{handle}"

# Hacker News
curl -sL "https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=10&orderBy=%22%24key%22"

# YouTube 자막
yt-dlp --write-sub --write-auto-sub --sub-lang "en,ko" --skip-download -o "/tmp/%(id)s" "URL"
```

## No-Site-Name Rule

`engine/**`, `waf_profiles.yaml`, `engine/templates/**` 파일에는 **특정 사이트의 도메인/URL/셀렉터/브랜드명을 하드코딩하지 않는다**.

### 금지

- `"coupang.com": {...}` 같은 사이트별 레지스트리 엔트리
- `if "coupang" in url: ...` 같은 도메인 분기
- WAF 프로파일 `notes`에 특정 사이트 이름이나 경험적 byte 크기 박제

### 허용

- `SKILL.md` / `references/*.md`의 **설명 텍스트**에 사이트 이름 예시 (독자 이해용)
- `Phase 0` 공식 API 인덱스 (플랫폼이 공식 공개한 엔드포인트)
- `observations/*.jsonl` 로그 (append-only 관측 데이터 — 코드 경로에 영향 없음)
- 호출자가 제공하는 `success_selectors`, `user_hint` (현재 호출에만 유효)

### 경계 사례 판단 기준

> "이 엔트리가 다른 사이트에서도 같은 WAF를 쓰면 일반적으로 유효한가?" → YES면 `waf_profiles.yaml`, NO면 runtime hint.

### 새 사이트가 안 뚫릴 때

1. 먼저 `result.trace`에서 어느 phase가 실패했는지 확인
2. 사용자의 `user_hint`로 1회 재시도
3. 반복 성공 패턴이 관측되면 `observations/`에 로그 (아직 자동 기록 없음 — 수동)
4. 3회+ 반복 확인되고 **동일 WAF를 쓰는 다른 사이트에도 유효**하면 `waf_profiles.yaml` 해당 프로파일의 `tls_impersonate_candidates` / `url_transform_order`를 튜닝 (사이트명 절대 넣지 않음)
5. 여전히 안 되면 새 WAF 프로파일 후보 검토 (예: DataDome 세부화, Kasada 등)

## 관련 문서 (references/) — 언제 무엇을 읽을지

이 섹션은 **참조 파일 선택 가이드**다. 문제가 생겼을 때 어떤 `references/*.md`를 열어야 할지 결정하는 기준으로 쓴다. Claude는 필요할 때만 해당 파일을 `Read`하고, 선제적으로 전부 읽지 않는다.

### A. Engine 확장·진단 (하네스 내부)

| 파일 | 언제 읽는가 | 무엇을 다루는가 |
|------|-------------|-----------------|
| [`tls-impersonate.md`](tls-impersonate.md) | curl_cffi 격자가 전부 `challenge`/`blocked`로 끝날 때, 새 impersonate 타겟을 `waf_profiles.yaml`에 추가할 때 | curl_cffi로 Safari/Chrome/Firefox TLS(JA3/JA4) 지문 복제하는 방법, WAF(Akamai/Cloudflare/F5 등)별 최적 타겟 조합, 임퍼소네이션 타겟 버전 목록, `tls_impersonate_avoid`의 실증 근거 |
| [`playwright.md`](playwright.md) | engine이 Playwright fallback으로 넘어가는데 MCP/Local Chrome 중 어디로 갈지 확인 필요할 때 | Approach 1 (`mcp__playwright__*` — Cloudflare급 챌린지), Approach 2 (Local Node + `channel:'chrome'` + stealth — Akamai Bot Manager급), 템플릿 파라미터 규격 |
| [`fallback.md`](fallback.md) | `verdict`가 애매하거나 Phase 전환 타이밍 결정 필요할 때 | engine의 Phase 0→1→2→3 에스컬레이션 원칙, 응답 성공/실패 판정 기준 세부, 각 Phase 종료 조건 |
| [`metadata.md`](metadata.md) | 본문 전체를 못 가져왔지만 제목·요약·가격·저자 같은 핵심만이라도 필요할 때 | OGP 메타 태그, JSON-LD (Schema.org), Twitter Card 파싱, 구조화 데이터 추출 패턴 |

### B. 경량 대안 (engine 말고 다른 도구가 나은 상황)

| 파일 | 언제 읽는가 | 무엇을 다루는가 |
|------|-------------|-----------------|
| [`jina.md`](jina.md) | WAF 없는 일반 웹(블로그·뉴스·Wiki)의 깨끗한 마크다운 추출 필요할 때 | `r.jina.ai/URL` 한 줄로 Puppeteer 기반 JS SPA 렌더링, 마크다운 변환, 무료 500 RPM, API 키 불필요 |
| [`cache-archive.md`](cache-archive.md) | 원본 사이트가 차단됐지만 과거 스냅샷으로라도 접근 필요할 때 | Wayback Machine CDX API, archive.today, AMP Cache (Google Cache는 2024-07 종료됨) |
| [`rss.md`](rss.md) | 뉴스·블로그·커뮤니티의 시계열 업데이트를 구조화해 받고 싶을 때 | RSS/Atom 자동 발견, 피드 파싱, 인증 불필요 — 가장 깔끔한 시계열 데이터 소스 |

### C. 플랫폼별 공식/공개 API (Phase 0 인덱스와 연결)

| 파일 | 언제 읽는가 | 무엇을 다루는가 |
|------|-------------|-----------------|
| [`json-api.md`](json-api.md) | Reddit/Wikipedia/HN/npm/PyPI 등 **URL 변형만으로** JSON을 주는 사이트 | Reddit `/json` suffix + Mobile UA, HN Firebase, Algolia Search, Wikipedia REST, npm/PyPI Registry API |
| [`public-api.md`](public-api.md) | Bluesky/Mastodon/arXiv/Stack Overflow/CrossRef/GitHub/OpenLibrary/Wayback 공식 API 사용 시 | 인증 없이 쓰는 공식 공개 REST/AT/Atom API 엔드포인트, 요청 형식, 공통 파라미터 |
| [`twitter.md`](twitter.md) | X/Twitter 접근 — 프로필 타임라인, 특정 트윗, 키워드 검색 | `syndication.twitter.com` 타임라인, oEmbed 개별 트윗, 검색은 WebSearch로 URL 확보 후 oEmbed |
| [`naver.md`](naver.md) | 네이버 블로그·뉴스·증권·검색 접근 | 서비스별 대체 접근(블로그는 `m.blog.naver.com` 변환, 증권은 비공식 JSON, 검색은 `search.naver.com`), 한글 검색 쿼리 패턴 |
| [`media.md`](media.md) | YouTube/Vimeo/Twitch/TikTok/SoundCloud 등 미디어 메타·자막·오디오 필요 시 | `yt-dlp --dump-json` 기반 1,858개 사이트 커버, 자막 다운로드(`--write-sub`), 포맷 선택, 라이브/팟캐스트 |

### D. Engine 코드 직접 읽을 때

| 파일 | 언제 읽는가 |
|------|-------------|
| `engine/fetch_chain.py` | 체인 단계 로직·`Attempt`/`FetchResult` schema 확인 |
| `engine/validators.py` | 4-계층 검증 세부 (Verdict 분류, 챌린지 마커 목록) |
| `engine/waf_detector.py` | WAF 랭킹 감지 알고리즘, `_LAST_LOAD_ERROR` 처리 |
| `engine/waf_profiles.yaml` | 프로파일별 detectors·tls_candidates·capabilities_needed |
| `engine/url_transforms.py` | URL 변환 규칙 추가할 때 |
| `engine/executor.py` | Playwright MCP vs local capability 매칭 로직 |
| `engine/templates/*.js` | Playwright 템플릿 튜닝 (warmup, reload, devices) |
| `engine/bias_check.py` | 편향 린터 규칙 — brand denylist, URL_PATTERN, excluded dirs |
