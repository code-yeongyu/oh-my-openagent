# 데이터 스크래핑 가이드

대용량 데이터셋(팔로워, 게시물, 검색 결과)의 경우, DOM을 스크롤하고 파싱하기보다 **네트워크 요청을 가로채고 재실행**하세요. 이 방식이 더 빠르고 안정적이며, 페이지네이션을 자동으로 처리합니다.

## 왜 스크롤하지 않나?

스크롤은 느리고, 불안정하며, 시간을 낭비합니다. API는 페이지네이션이 내장된 구조화된 데이터를 반환합니다. 항상 API 재실행을 선호하세요.

## 작게 시작해서 확장하기

**모든 것을 한 번에 자동화하려고 하지 마세요.** 점진적으로 작업하세요:

1. **요청 하나 캡처** - 올바른 엔드포인트를 가로채고 있는지 확인
2. **응답 하나 검사** - 추출 코드를 작성하기 전에 스키마 이해
3. **몇 개 항목 추출** - 파싱 로직이 작동하는지 확인
4. **그 후 확장** - 기본이 작동한 후에만 페이지네이션 루프 추가

이는 `data.user.timeline` 대 `data.user.result.timeline` 같은 단순한 경로 문제가 원인일 때 복잡한 스크립트를 디버깅하는 시간 낭비를 방지합니다.

## 단계별 워크플로우

### 1. 요청 세부 정보 캡처

먼저, URL 구조와 필요한 헤더를 이해하기 위해 요청을 가로챕니다:

```typescript
import { connect, waitForPageLoad } from "@/client.js";
import * as fs from "node:fs";

const client = await connect();
const page = await client.page("site");

let capturedRequest = null;
page.on("request", (request) => {
  const url = request.url();
  // API 엔드포인트 찾기 (대상 사이트에 맞게 패턴 조정)
  if (url.includes("/api/") || url.includes("/graphql/")) {
    capturedRequest = {
      url: url,
      headers: request.headers(),
      method: request.method(),
    };
    fs.writeFileSync("tmp/request-details.json", JSON.stringify(capturedRequest, null, 2));
    console.log("Captured request:", url.substring(0, 80) + "...");
  }
});

await page.goto("https://example.com/profile");
await waitForPageLoad(page);
await page.waitForTimeout(3000);

await client.disconnect();
```

### 2. 스키마를 이해하기 위해 응답 캡처

데이터 구조를 검사하기 위해 원시 응답을 저장합니다:

```typescript
page.on("response", async (response) => {
  const url = response.url();
  if (url.includes("UserTweets") || url.includes("/api/data")) {
    const json = await response.json();
    fs.writeFileSync("tmp/api-response.json", JSON.stringify(json, null, 2));
    console.log("Captured response");
  }
});
```

그런 다음 구조를 분석해 다음을 찾습니다:

- 데이터 배열의 위치 (예: `data.user.result.timeline.instructions[].entries`)
- 페이지네이션 커서의 위치 (예: `cursor-bottom` 항목)
- 추출해야 할 필드

### 3. 페이지네이션을 사용한 API 재실행

스키마를 이해한 후, 요청을 직접 재실행합니다:

```typescript
import { connect } from "@/client.js";
import * as fs from "node:fs";

const client = await connect();
const page = await client.page("site");

const results = new Map(); // 중복 제거를 위해 Map 사용
const headers = JSON.parse(fs.readFileSync("tmp/request-details.json", "utf8")).headers;
const baseUrl = "https://example.com/api/data";

let cursor = null;
let hasMore = true;

while (hasMore) {
  // 페이지네이션 커서로 URL 빌드
  const params = { count: 20 };
  if (cursor) params.cursor = cursor;
  const url = `${baseUrl}?params=${encodeURIComponent(JSON.stringify(params))}`;

  // 브라우저 컨텍스트에서 fetch 실행 (인증 쿠키/헤더 보유)
  const response = await page.evaluate(
    async ({ url, headers }) => {
      const res = await fetch(url, { headers });
      return res.json();
    },
    { url, headers }
  );

  // 데이터와 커서 추출 (사용 중인 API에 맞게 경로 조정)
  const entries = response?.data?.entries || [];
  for (const entry of entries) {
    if (entry.type === "cursor-bottom") {
      cursor = entry.value;
    } else if (entry.id && !results.has(entry.id)) {
      results.set(entry.id, {
        id: entry.id,
        text: entry.content,
        timestamp: entry.created_at,
      });
    }
  }

  console.log(`Fetched page, total: ${results.size}`);

  // 중지 조건 확인
  if (!cursor || entries.length === 0) hasMore = false;

  // 속도 제한 - 정중하게
  await new Promise((r) => setTimeout(r, 500));
}

// 결과 내보내기
const data = Array.from(results.values());
fs.writeFileSync("tmp/results.json", JSON.stringify(data, null, 2));
console.log(`Saved ${data.length} items`);

await client.disconnect();
```

## 핵심 패턴

| 패턴                    | 설명                                                   |
| ----------------------- | ------------------------------------------------------ |
| `page.on('request')`    | 발신 요청 URL + 헤더 캡처                              |
| `page.on('response')`   | 스키마를 이해하기 위해 응답 데이터 캡처                |
| `page.evaluate(fetch)`  | 브라우저 컨텍스트에서 요청 재실행 (인증 상속)          |
| `Map`으로 중복 제거     | API는 종종 페이지 간 중복되는 데이터를 반환            |
| 커서 기반 페이지네이션  | 응답에서 `cursor`, `next_token`, `offset` 찾기         |

## 팁

- **확장 프로그램 모드**: `page.context().cookies()`는 작동하지 않습니다 - 가로챈 요청에서 인증 헤더를 캡처하세요
- **속도 제한**: 차단을 피하기 위해 요청 사이에 500ms 이상의 지연 추가
- **중지 조건**: 빈 결과, 누락된 커서, 또는 날짜/ID 임계값 도달 확인
- **GraphQL API**: URL 매개변수에 종종 `variables`와 `features` JSON 객체가 포함됨 - 캡처하고 재사용
