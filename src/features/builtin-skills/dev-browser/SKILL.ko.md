---
name: dev-browser
description: 페이지 상태가 유지되는 브라우저 자동화. 사용자가 웹사이트 탐색, 폼 작성, 스크린샷 촬영, 웹 데이터 추출, 웹 앱 테스트, 또는 브라우저 워크플로우 자동화를 요청할 때 사용하세요. 트리거 문구: "[url]로 이동", "클릭", "폼 작성", "스크린샷 촬영", "스크래핑", "자동화", "웹사이트 테스트", "로그인" 또는 모든 브라우저 상호작용 요청.
---

# Dev Browser Skill

스크립트 실행 간에 페이지 상태를 유지하는 브라우저 자동화입니다. 작은 단위의 집중된 스크립트를 작성해 작업을 점진적으로 수행하세요. 워크플로우의 일부를 검증하고 반복 작업이 필요해지면, 한 번의 실행으로 반복 작업을 처리하는 스크립트를 작성할 수 있습니다.

## 접근 방식 선택

- **로컬/소스 공개 사이트**: 먼저 소스 코드를 읽어 셀렉터를 직접 작성
- **알 수 없는 페이지 레이아웃**: `getAISnapshot()`으로 요소를 발견하고 `selectSnapshotRef()`로 상호작용
- **시각적 피드백**: 사용자가 보는 것을 보기 위해 스크린샷 촬영

## 설정

> **설치**: Windows 지원을 포함한 자세한 설정 지침은 [references/installation.md](references/installation.md)를 참조하세요.

두 가지 모드가 있습니다. 어느 것을 사용할지 불분명하면 사용자에게 물어보세요.

### 독립 실행 모드 (기본값)

새로운 자동화 세션을 위해 새 Chromium 브라우저를 실행합니다.

```bash
./skills/dev-browser/server.sh &
```

사용자가 요청하면 `--headless` 플래그를 추가하세요. **스크립트를 실행하기 전 `Ready` 메시지를 기다리세요.**

### 확장 프로그램 모드

사용자의 기존 Chrome 브라우저에 연결합니다. 다음 경우에 사용:

- 사용자가 이미 사이트에 로그인되어 있고, 로컬 개발이 아닌 인증된 환경 뒤에서 작업하기를 원할 때.
- 사용자가 확장 프로그램 사용을 요청할 때

**중요**: 핵심 흐름은 동일합니다. 사용자의 브라우저 안에 명명된 페이지를 생성합니다.

**릴레이 서버 시작:**

```bash
cd skills/dev-browser && npm i && npm run start-extension &
```

콘솔에서 `Waiting for extension to connect...` 다음에 `Extension connected`가 표시될 때까지 기다리세요. 이로써 클라이언트가 연결되었고 브라우저를 제어할 준비가 되었음을 알 수 있습니다.
**워크플로우:**

1. 스크립트는 일반 모드처럼 `client.page("name")`을 호출해 새 페이지를 생성하거나 기존 페이지에 연결합니다.
2. 자동화는 사용자의 실제 브라우저 세션에서 실행됩니다

확장 프로그램이 아직 연결되지 않았다면, 사용자에게 실행 후 활성화하라고 안내하세요. 다운로드 링크: https://github.com/SawyerHood/dev-browser/releases

## 스크립트 작성

> **모든 스크립트는 `skills/dev-browser/` 디렉토리에서 실행하세요.** `@/` 임포트 별칭은 이 디렉토리의 설정을 필요로 합니다.

heredoc을 사용해 스크립트를 인라인으로 실행:

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
// 사용자 정의 뷰포트 크기로 페이지 생성 (선택)
const page = await client.page("example", { viewport: { width: 1920, height: 1080 } });

await page.goto("https://example.com");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
```

**`tmp/` 파일에 작성하는 경우는** 스크립트의 재사용이 필요하거나, 복잡하거나, 사용자가 명시적으로 요청한 경우에만 한정합니다.

### 핵심 원칙

1. **작은 스크립트**: 각 스크립트는 한 가지 작업만 수행 (탐색, 클릭, 채우기, 확인)
2. **상태 평가**: 다음 단계를 결정하기 위해 마지막에 상태를 로그/반환
3. **설명적인 페이지 이름**: `"main"`이 아닌 `"checkout"`, `"login"` 사용
4. **종료 시 disconnect**: `await client.disconnect()` - 페이지는 서버에 유지됨
5. **evaluate 안에는 순수 JS**: `page.evaluate()`는 브라우저에서 실행됨 - TypeScript 문법 사용 불가

## 워크플로우 루프

복잡한 작업에는 다음 패턴을 따릅니다:

1. **스크립트 작성** 한 가지 액션 수행
2. **실행** 후 출력 관찰
3. **평가** - 작동했나? 현재 상태는?
4. **결정** - 작업이 완료됐나, 다른 스크립트가 필요한가?
5. **작업 완료까지 반복**

### 브라우저 컨텍스트에는 TypeScript 사용 불가

`page.evaluate()`에 전달된 코드는 브라우저에서 실행되며, TypeScript를 이해하지 못합니다:

```typescript
// ✅ 올바름: 순수 JavaScript
const text = await page.evaluate(() => {
  return document.body.innerText;
});

// ❌ 잘못됨: TypeScript 문법은 런타임에 실패
const text = await page.evaluate(() => {
  const el: HTMLElement = document.body; // 타입 어노테이션은 브라우저에서 깨짐!
  return el.innerText;
});
```

## 데이터 스크래핑

대용량 데이터셋 스크래핑의 경우, DOM을 스크롤하기보다 **네트워크 요청을 가로채고 재실행**하세요. 요청 캡처, 스키마 발견, 페이지네이션 API 재실행을 다루는 전체 가이드는 [references/scraping.md](references/scraping.md)를 참조하세요.

## 클라이언트 API

```typescript
const client = await connect();

// 명명된 페이지 가져오기 또는 생성 (viewport는 새 페이지에만 적용)
const page = await client.page("name");
const pageWithSize = await client.page("name", { viewport: { width: 1920, height: 1080 } });

const pages = await client.list(); // 모든 페이지 이름 나열
await client.close("name"); // 페이지 닫기
await client.disconnect(); // 연결 해제 (페이지는 유지됨)

// ARIA 스냅샷 메서드
const snapshot = await client.getAISnapshot("name"); // 접근성 트리 가져오기
const element = await client.selectSnapshotRef("name", "e5"); // ref로 요소 가져오기
```

`page` 객체는 표준 Playwright Page입니다.

## 대기

```typescript
import { waitForPageLoad } from "@/client.js";

await waitForPageLoad(page); // 탐색 후
await page.waitForSelector(".results"); // 특정 요소 대기
await page.waitForURL("**/success"); // 특정 URL 대기
```

## 페이지 상태 검사

### 스크린샷

```typescript
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });
```

### ARIA 스냅샷 (요소 발견)

`getAISnapshot()`을 사용해 페이지 요소를 발견합니다. YAML 형식의 접근성 트리를 반환합니다:

```yaml
- banner:
  - link "Hacker News" [ref=e1]
  - navigation:
    - link "new" [ref=e2]
- main:
  - list:
    - listitem:
      - link "Article Title" [ref=e8]
      - link "328 comments" [ref=e9]
- contentinfo:
  - textbox [ref=e10]
    - /placeholder: "Search"
```

**ref 해석:**

- `[ref=eN]` - 상호작용용 요소 참조 (보이고 클릭 가능한 요소만)
- `[checked]`, `[disabled]`, `[expanded]` - 요소 상태
- `[level=N]` - 헤딩 레벨
- `/url:`, `/placeholder:` - 요소 속성

**ref와 상호작용:**

```typescript
const snapshot = await client.getAISnapshot("hackernews");
console.log(snapshot); // 필요한 ref 찾기

const element = await client.selectSnapshotRef("hackernews", "e2");
await element.click();
```

## 오류 복구

페이지 상태는 실패 후에도 유지됩니다. 디버그 방법:

```bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect } from "@/client.js";

const client = await connect();
const page = await client.page("hackernews");

await page.screenshot({ path: "tmp/debug.png" });
console.log({
  url: page.url(),
  title: await page.title(),
  bodyText: await page.textContent("body").then((t) => t?.slice(0, 200)),
});

await client.disconnect();
EOF
```
