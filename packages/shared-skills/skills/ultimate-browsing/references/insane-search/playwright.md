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
새 브라우저 세션은 js eval의 Bun.WebView(Bun >= 1.4, macOS 기본;
Linux/Windows는 설치된 Chrome/Chromium/Edge 필요), 그 외 또는 Chrome 동작·stealth·trace·인증은
로컬 Chrome을 제어하는 `playwright-core` 스크립트로 실행한다. MCP를 새로 설치하지 않는다.

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

```bash
# Node (시스템 설치)
node -v   # v18+ 권장

# 사용자가 엔진 디렉터리에서 한 번 설치하는 스크립트 의존성
cd "$SKILL_DIR/engine"
test -f package.json || cp templates/package.json package.json
bun add playwright-core@1.62.1 playwright-extra@4.3.6 puppeteer-extra-plugin-stealth@2.11.2
# Chrome은 이미 시스템에 설치되어 있어야 한다. 브라우저 다운로드 명령은 없다.
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

내부에서 `engine/templates/playwright_real_chrome.js` 또는 `playwright_mobile_chrome.js`를 Node로 실행하고 HTML을 받아온다. 템플릿은 **URL과 셀렉터 파라미터만** 받으며 사이트별 분기가 없다.

### 데스크톱 템플릿 (`playwright_real_chrome.js`)

```js
const { addExtra } = require('playwright-extra');
const chromium = addExtra(require('playwright-core').chromium);
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',        // ← 핵심: 번들 Chromium 아닌 실제 Chrome
  headless: false,          // Akamai는 headless 탐지. headful 필요.
  viewport: { width: 1366, height: 900 },
});
```

### 모바일 템플릿 (`playwright_mobile_chrome.js`)

```js
const { devices } = require('playwright-core');
const { addExtra } = require('playwright-extra');
const chromium = addExtra(require('playwright-core').chromium);
const iPhone = devices['iPhone 13 Pro'];

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',          // TLS는 실제 Chrome
  ...iPhone,                  // UA/viewport/isMobile/hasTouch 자동 주입
  headless: false,
});
```

**주의**: `channel:'chrome'` + `devices[...]` 조합은 TLS 핑거프린트를 Chrome으로 유지하면서 HTTP 레이어(UA/viewport)만 모바일로 바꾼다. WAF가 실제 Chrome으로 인식해서 관대한 경우가 많다.

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

- 템플릿은 js eval에서 스크립트로 실행한다. `profileDir`는 작업 전용 경로나 사용자 프로필의 복제본만 사용한다.
- 사용자의 실제 프로필을 실행·초기화·삭제하지 않는다. 작업 종료 시 컨텍스트를 닫고 작업 전용 복제본만 정리한다.
- 실패 시 `result.trace`의 `error` 필드에 Node stderr 200자가 포함됨

## 사이트 예시 (독자 이해용, 코드 분기 근거 아님)

> 이 섹션은 **설명 목적**이며 `engine/**` 코드에는 반영되지 않는다.

- **Cloudflare 기본 챌린지**: Approach 1 (MCP) 충분
- **Akamai Bot Manager**: Approach 2 필수. MCP로는 TLS-UA 불일치 탐지됨
- **SSR 블로그 플랫폼**: curl_cffi safari만으로 HTML 수신. Playwright 불필요
- **검색 결과 JS 렌더링 SPA**: Approach 1로 `browser_wait_for` 후 `browser_snapshot`

실제 라우팅은 프로파일 태그가 결정한다. 위 예시는 참고일 뿐 코드 분기 근거로 쓰지 않는다.
