# Playwright — MCP vs Local Chrome

> JS 렌더링 / JS 챌린지 사이트를 위한 두 가지 접근. **WAF 프로파일의
> `capabilities_needed` 태그가 선택을 결정**한다. 사용자가 직접 고를 필요 없다.

## 두 Approach 요약

| Approach | 실행기 | TLS 스택 | 적합 WAF | 한계 |
|----------|--------|----------|----------|------|
| **1. MCP** | `mcp__playwright__*` 도구 | Playwright 번들 Chromium (BoringSSL) | Cloudflare 기본, CAPTCHA 없는 SPA, JS 챌린지 약한 사이트 | Akamai Bot Manager 등 TLS-감지형 WAF에 **즉시 탐지됨** (`channel` 옵션 없음) |
| **2. Local Node + `channel:'chrome'`** | `engine/templates/playwright_real_chrome.js` | 시스템 설치 실제 Chrome | Akamai Bot Manager, PerimeterX, DataDome 강화 설정 | Node + Chrome 시스템 설치 필요 |

`engine/executor.py`가 프로파일 태그를 보고 자동 라우팅하므로, 이 선택을 스킬 외부에서 의식할 필요는 없다.

## Approach 1 — Playwright MCP

### 의존성

이 항목은 이미 연결된 MCP를 사용하는 엔진 어댑터의 설명이다.
에이전트가 직접 여는 브라우저 세션은 js eval의 omowright(`browser` 스킬에 스테이징)로
띄운다: 직접 소유 브라우저는 `connectPipe`, 스텔스는 `connectCloakProfile`, 사용자 로그인이
필요하면 `connectBrowserSkill`. MCP를 새로 설치하지 않는다.

### 기본 워크플로

```
1. browser_navigate → URL
2. browser_wait_for → 메인 콘텐츠 셀렉터 (SPA는 필수)
3. browser_snapshot    (접근성 트리 — 토큰 효율)
   또는
   browser_evaluate    (특정 셀렉터 데이터 추출)
   또는
   browser_run_code    (스크롤/페이지네이션)
```

### 도구별 용도

| 도구 | 용도 |
|------|------|
| `browser_snapshot` | 접근성 트리 반환 — 텍스트+인터랙티브 요소 구조화. 가장 빠르고 토큰 효율적 |
| `browser_evaluate` | `() => document.querySelector(...).innerText` 등 JS 평가 |
| `browser_run_code` | `async ({ page }) => {...}` 풀 자동화 — 무한 스크롤, 다단계 인터랙션 |
| `browser_network_requests` | XHR/fetch 호출 목록 — **WAF 뒤 진짜 API 엔드포인트 발견용** (→ curl_cffi로 직접 호출) |
| `browser_console_messages` | JS 에러/로그 |

### 주의

- MCP는 Chromium 번들 기반. TLS 지문이 BoringSSL이라 Akamai/DataDome은 **293 바이트 Access Denied** 또는 즉시 403 반환.
- 이 경우 자동으로 Approach 2로 이관되도록 `engine/executor.py`가 처리. 수동 선택 불필요.

## Approach 2 — Local Node + Real Chrome

### 의존성 (최초 1회)

엔진 템플릿의 스크립트 의존성은 `engine/templates/package.json`에 고정되어 있다.
엔진 디렉터리에서 한 번만 설치한다. Chrome은 이미 시스템에 설치되어 있어야 하며,
브라우저 다운로드 명령은 없다.

```bash
cd "$SKILL_DIR/engine"
test -f package.json || cp templates/package.json package.json
bun install
```

### 호출 (engine 내부)

```python
from insane_search.engine.executor import run_playwright_fallback

attempt, html = run_playwright_fallback(
    "https://example.com/path",
    profile_id="akamai_bot_manager",
    success_selectors=["article"],
    device_class="desktop",   # "desktop" | "mobile" | "auto"
)
```

내부에서 `engine/templates/playwright_real_chrome.js` 또는 `playwright_mobile_chrome.js`를 Node로 실행하고 HTML을 받아온다. 템플릿은 **URL과 셀렉터 파라미터만** 받으며 사이트별 분기가 없다. 템플릿은 엔진이 실행하는 프로그램이다. 에이전트가 이 템플릿을 본떠 브라우저 스크립트를 새로 쓰지 않는다.

### 데스크톱 템플릿 (`playwright_real_chrome.js`)

- 번들 Chromium이 아니라 **시스템에 설치된 실제 Chrome**을 띄운다. TLS 지문이 실제 Chrome이 되는 것이 핵심이다.
- stealth 플러그인을 적용하고, 작업 전용 영속 프로필 디렉터리를 쓴다.
- Akamai는 headless를 탐지하므로 **headful**로 실행하고, 뷰포트는 1366×900이다.

### 모바일 템플릿 (`playwright_mobile_chrome.js`)

- TLS는 데스크톱과 같은 실제 Chrome이고, iPhone 13 Pro 디바이스 기술자(UA/viewport/isMobile/hasTouch)만 주입한다. headful로 실행한다.

**주의**: 실제 Chrome + 모바일 디바이스 기술자 조합은 TLS 핑거프린트를 Chrome으로 유지하면서 HTTP 레이어(UA/viewport)만 모바일로 바꾼다. WAF가 실제 Chrome으로 인식해서 관대한 경우가 많다.

### 엔진 밖에서 같은 효과가 필요할 때

엔진 폴백이 아니라 에이전트가 직접 페이지를 조작해야 한다면 js eval에서 omowright(`browser` 스킬에 스테이징)를 쓴다. 지문이 고정된 스텔스 브라우저는 `connectCloakProfile({ profileDir })`, 모바일 뷰는 `emulate(page, "iphone-14")`, 사용자 로그인이 필요하면 `connectBrowserSkill()`이다.

## 선택 규칙 (자동)

`engine/waf_profiles.yaml`의 `capabilities_needed` 태그가 결정한다:

| 태그 조합 | 선택 실행기 | 대표 케이스 |
|----------|-------------|-------------|
| `needs_real_tls_stack` + `needs_js_exec` | Approach 2 (real_chrome) | Akamai Bot Manager |
| `needs_js_exec` only | Approach 1 (MCP) | Cloudflare Turnstile |
| `needs_real_tls_stack` only | Approach 2 (real_chrome) | 일부 DataDome 설정 |
| 둘 다 없음 | curl 체인에서 해결. Playwright 안 씀 | F5 BIG-IP (TLS만 우회 필요) |

`device_class="mobile"`이 지정되면 real_chrome → mobile 변종으로 swap.

## 공통 검증

두 Approach 모두 최종 HTML을 `engine/validators.py:validate()`로 재검증한다. 즉 Playwright가 HTML을 받아와도 **챌린지 페이지 또는 빈 SPA면 여전히 CHALLENGE 판정**. 자동으로 다음 조합이나 failure 보고로 이어진다.

## 디버깅 팁

- 템플릿의 `profileDir`는 작업 전용 경로만 사용한다. 사용자의 실제 프로필을 실행·복제·초기화·삭제하지 않는다.
- 작업 종료 시 브라우저를 닫고 작업 전용 프로필만 정리한다.
- 실패 시 `result.trace`의 `error` 필드에 Node stderr 200자가 포함됨

## 사이트 예시 (독자 이해용, 코드 분기 근거 아님)

> 이 섹션은 **설명 목적**이며 `engine/**` 코드에는 반영되지 않는다.

- **Cloudflare 기본 챌린지**: Approach 1 (MCP) 충분
- **Akamai Bot Manager**: Approach 2 필수. MCP로는 TLS-UA 불일치 탐지됨
- **SSR 블로그 플랫폼**: curl_cffi safari만으로 HTML 수신. Playwright 불필요
- **검색 결과 JS 렌더링 SPA**: Approach 1로 `browser_wait_for` 후 `browser_snapshot`

실제 라우팅은 프로파일 태그가 결정한다. 위 예시는 참고일 뿐 코드 분기 근거로 쓰지 않는다.
