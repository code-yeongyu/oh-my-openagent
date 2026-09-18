# 공개 API 직접 호출

> 인증 없이 구조화된 데이터를 반환하는 공개 API.
> 웹 크롤링이 아니라 공식 API — 안정적이고 정확.

## Bluesky (AT Protocol)

프로필과 피드는 완전 공개. 검색은 403 차단.

```bash
# 프로필
curl -sL "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={handle}" | \
python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d[\"displayName\"]} — Followers: {d[\"followersCount\"]}, Posts: {d[\"postsCount\"]}')"

# 피드 (최근 게시물)
curl -sL "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor={handle}&limit=10"
```

Rate limit: ~3,000 req/hour

## Mastodon

인스턴스별 상이. mastodon.social은 공개 타임라인 차단, hachyderm.io/fosstodon.org 등은 허용.

```bash
# 계정 조회
curl -sL "https://{instance}/api/v1/accounts/lookup?acct={username}"

# 계정 타임라인 (ID 획득 후)
curl -sL "https://{instance}/api/v1/accounts/{id}/statuses?limit=10"

# 해시태그 타임라인 (인스턴스에 따라 인증 필요)
curl -sL "https://hachyderm.io/api/v1/timelines/tag/{tag}?limit=10"
```

## Stack Exchange (v2.3)

```bash
# 질문 검색
curl -sL "https://api.stackexchange.com/2.3/search?order=desc&sort=votes&intitle={query}&site=stackoverflow"

# 태그 기반
curl -sL "https://api.stackexchange.com/2.3/questions?tagged={tag1};{tag2}&site=stackoverflow&pagesize=5"

# 답변 포함 (본문 필요 시)
curl -sL "https://api.stackexchange.com/2.3/questions/{id}/answers?order=desc&sort=votes&site=stackoverflow&filter=withbody"
```

Rate limit: 비인증 300 req/day (IP당)

## arXiv (학술 논문)

```bash
# 논문 검색 (ti=제목, au=저자, abs=초록, cat=카테고리)
curl -sL "http://export.arxiv.org/api/query?search_query=ti:{query}&max_results=5&sortBy=submittedDate&sortOrder=descending"
```

**주의**: 3 req/second 제한. 요청 간 1초 sleep 필수.
카테고리: cs.AI, cs.CL, cs.LG, cs.CV 등

## CrossRef (DOI / 피어리뷰 논문)

```bash
# 논문 검색
curl -sL "https://api.crossref.org/works?query={query}&filter=from-pub-date:2025-01&rows=5&sort=relevance"

# DOI로 조회
curl -sL "https://api.crossref.org/works/{DOI}"
```

Rate limit: 50 req/second. User-Agent에 이메일 추가 시 Polite Pool 진입.

## OpenLibrary (도서)

```bash
# ISBN 조회
curl -sL "https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&jscmd=data&format=json"

# 도서 검색
curl -sL "https://openlibrary.org/search.json?q={query}&limit=5"
```

## Wayback Machine (아카이브)

```bash
# 스냅샷 확인
curl -sL "https://archive.org/wayback/available?url={URL}"

# CDX API (스냅샷 목록)
curl -sL "https://web.archive.org/cdx/search/cdx?url={URL}&output=json&fl=timestamp,statuscode&limit=5"
```

## GitHub REST API (gh CLI 없을 때)

비인증 60 req/hour. gh CLI 우선 사용 권장.

```bash
# 저장소 검색
curl -sL "https://api.github.com/search/repositories?q={query}&sort=stars&per_page=5"

# 릴리즈
curl -sL "https://api.github.com/repos/{owner}/{repo}/releases?per_page=5"

# 코드 검색
curl -sL "https://api.github.com/search/code?q={query}+language:python&per_page=5"
```

## Rate Limit 요약

| API | 비인증 | 비고 |
|-----|-------|------|
| Bluesky | ~3K/hr | 검색 403 |
| Mastodon | 인스턴스별 | |
| Stack Exchange | 300/day | 인증 시 10K |
| arXiv | 3/sec | sleep 필수 |
| CrossRef | 50/sec | |
| OpenLibrary | 무제한 | |
| Wayback | 무제한 | |
| GitHub REST | 60/hr | gh CLI 우선 |
