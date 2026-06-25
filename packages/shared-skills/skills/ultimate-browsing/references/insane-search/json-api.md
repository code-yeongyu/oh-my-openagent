# JSON API 직접 호출

> URL 변형이나 공개 엔드포인트로 구조화된 JSON을 직접 가져오는 패턴.
> 인증 불필요. Jina Reader보다 빠르고 정확한 구조화 데이터 획득.

## Reddit

**Mobile User-Agent 필수** (없으면 403/429).

```bash
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"

# 서브레딧 핫 포스트
curl -sL -H "User-Agent: $UA" "https://www.reddit.com/r/{subreddit}/hot.json?limit=10"

# 검색
curl -sL -H "User-Agent: $UA" "https://www.reddit.com/r/{subreddit}/search.json?q={query}&restrict_sr=1"

# 포스트 + 댓글
curl -sL -H "User-Agent: $UA" "https://www.reddit.com/r/{subreddit}/comments/{post_id}/{slug}/.json"

# 정렬: hot.json / new.json / top.json?t=week
```

데이터: `title`, `author`, `score`, `selftext`(전문), `num_comments`, `created_utc`
댓글: 응답 `[1]` 배열에 재귀적 트리

## Hacker News (Firebase API)

Rate limit 사실상 없음.

```bash
# 탑 스토리 ID 목록
curl -sL "https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=10&orderBy=%22%24key%22"

# 개별 아이템
curl -sL "https://hacker-news.firebaseio.com/v0/item/{id}.json"

# 변형: beststories / newstories / askstories / showstories
```

데이터: `title`, `url`, `score`, `by`(작성자), `descendants`(댓글수), `kids`(댓글 ID)

배치 조회:
```bash
python3 -c "
import urllib.request, json
ids = json.load(urllib.request.urlopen('https://hacker-news.firebaseio.com/v0/topstories.json?limitToFirst=5&orderBy=\"\$key\"'))
for id in ids:
    item = json.load(urllib.request.urlopen(f'https://hacker-news.firebaseio.com/v0/item/{id}.json'))
    print(f'[{item.get(\"score\",0)}] {item.get(\"title\")}')
    print(f'  {item.get(\"url\",\"N/A\")[:60]}')
"
```

## Lobste.rs

Rate limit 없음. HN보다 작지만 고품질 큐레이션.

```bash
# 핫 스토리
curl -sL "https://lobste.rs/hottest.json"

# 태그별 (ai, programming, web, security 등)
curl -sL "https://lobste.rs/t/ai.json"

# 최신
curl -sL "https://lobste.rs/newest.json"

# 개별 스토리 + 댓글
curl -sL "https://lobste.rs/s/{short_id}.json"
```

데이터: `title`, `url`, `score`, `comment_count`, `tags`, `submitter_user`

## dev.to

```bash
# 태그별 최신
curl -sL "https://dev.to/api/articles?tag=ai&per_page=5"

# 이번 주 탑
curl -sL "https://dev.to/api/articles?top=7&per_page=5"

# 특정 유저
curl -sL "https://dev.to/api/articles?username={user}&per_page=5"
```

데이터: `title`, `user.name`, `public_reactions_count`, `reading_time_minutes`, `tags`

## npm Registry

```bash
# 패키지 최신 버전
curl -sL "https://registry.npmjs.org/{package}/latest"

# 패키지 검색
curl -sL "https://registry.npmjs.org/-/v1/search?text={query}&size=5"

# 다운로드 통계
curl -sL "https://api.npmjs.org/downloads/range/last-month/{package}"
```

## PyPI

```bash
# 패키지 정보
curl -sL "https://pypi.org/pypi/{package}/json"

# 다운로드 통계
curl -sL "https://pypistats.org/api/packages/{package}/recent"
```

## Wikipedia

```bash
# 페이지 요약
curl -sL "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
# 한국어: https://ko.wikipedia.org/api/rest_v1/page/summary/{title}

# 검색
curl -sL "https://en.wikipedia.org/w/api.php?action=opensearch&search={query}&limit=5&format=json"
```

## V2EX

```bash
curl -sL "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: insane-search/1.0"
```

## RSS 피드

→ [rss.md](rss.md)로 이동. 한국 언론 RSS, Google News RSS, feedparser 사용법 등 상세 가이드 참조.
