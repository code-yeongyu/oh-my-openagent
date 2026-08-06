# 범용 웹 추출 — Jina Reader

> `r.jina.ai/URL` 한 줄로 거의 모든 공개 URL을 마크다운으로 변환.
> Puppeteer 기반 실제 브라우저 렌더링 — JS SPA까지 처리.
> **API 키 불필요. 무료: 분당 500 RPM.**

## 기본 사용

```bash
curl -s "https://r.jina.ai/{URL}"
```

## 고급 기능

### JSON 구조화 출력

```bash
curl -H "Accept: application/json" "https://r.jina.ai/{URL}"
```

반환: `data.{title, description, url, content, metadata, external, usage}`

**핵심**: `external.alternate`에서 사이트의 **RSS URL을 자동 발견** 가능.

### CSS 선택자 타겟팅

```bash
curl -H "X-Target-Selector: .article-body" "https://r.jina.ai/{URL}"
```

네비게이션/풋터 제거, 본문만 추출. 커뮤니티 게시판에서 특히 효과적.

### SPA 스트리밍 모드

```bash
curl -H "Accept: text/event-stream" "https://r.jina.ai/{URL}"
```

JS 로딩 완료까지 대기. 동적 콘텐츠가 완전히 렌더링된 최종 버전 반환.

### 스크린샷

```bash
curl -H "X-Respond-With: screenshot" "https://r.jina.ai/{URL}"
```

GCS 서명 URL 반환 (4시간 유효). 비주얼 검증 용도.

### PDF 처리

```bash
curl -s "https://r.jina.ai/https://example.com/file.pdf"
```

PDF → 마크다운 자동 변환. 페이지 수 메타데이터 포함.

### 쿠키 전달 (인증 사이트)

```bash
curl -H "X-Set-Cookie: session=abc123" "https://r.jina.ai/{URL}"
```

### 링크 보존

```bash
curl -H "X-With-Links: true" "https://r.jina.ai/{URL}"
```

### 캐시 제어

```bash
# 캐시 우회 (실시간 필요 시)
curl -H "X-No-Cache: true" "https://r.jina.ai/{URL}"

# 캐시 TTL 지정 (초)
curl -H "X-Cache-Tolerance: 600" "https://r.jina.ai/{URL}"
```

### 순수 텍스트 / 원본 HTML

```bash
# body.innerText만
curl -H "X-Respond-With: text" "https://r.jina.ai/{URL}"

# 원본 HTML
curl -H "X-Respond-With: html" "https://r.jina.ai/{URL}"
```

## 검증된 성공 사이트

| 사이트 | 결과 | 비고 |
|--------|------|------|
| Threads | 성공 | 프로필 + 포스트 |
| 클리앙 | 성공 | 게시글 목록 + 본문 |
| 루리웹 | 성공 | 게시글 목록 + 본문 |
| 뽐뿌 | 성공 | 게시글 + RSS도 가능 |
| 네이버 뉴스 | 성공 | 기사 목록 + 본문 완전 |
| 네이버 증권 | 성공 | 실시간 주가 |
| 긱뉴스 | 성공 | 토픽 목록 + 본문 |
| 44bits | 성공 | 기사 목록 |
| 커리어리 | 성공 | JS 렌더링으로 추출 |
| 브런치 | 성공 | 기사 전문 |
| 한경 | 성공 | 뉴스 기사 |
| 다음 뉴스 | 성공 | 뉴스 기사 |
| Medium | 성공 | 기사 전문 (paywall 제외) |
| Substack | 성공 | 뉴스레터 전문 |
| dev.to | 성공 | 기사 전문 |
| PDF (모든 URL) | 성공 | 자동 변환 |

## 실패하는 사이트

| 사이트 | 이유 |
|--------|------|
| X/Twitter | 402 — Syndication/oEmbed 사용 (twitter.md 참조) |
| Reddit | 차단 — JSON API 사용 (json-api.md 참조) |
| 디시인사이드 | 빈 본문 반환 |
| 에펨코리아 | HTTP 430 |
| 요즘IT | CloudFront 403 |
| 네이버 쇼핑 | CAPTCHA |
| 쿠팡 | WAF 차단 |


## RSS 자동 발견

Jina JSON 모드의 `external.alternate`에서 사이트의 RSS URL이 자동 노출됨:

```bash
curl -H "Accept: application/json" "https://r.jina.ai/{URL}" | \
python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('external',{}))"
```
