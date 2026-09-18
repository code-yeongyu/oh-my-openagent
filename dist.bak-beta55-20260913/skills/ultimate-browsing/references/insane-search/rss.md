# RSS/Atom 피드

> 인증 불필요. URL만 알면 바로 구독. 뉴스/블로그/커뮤니티에서 가장 깔끔한 데이터.

## 의존성

```bash
python3 -c "import feedparser" 2>/dev/null || pip install feedparser -q
```

## RSS 자동 발견

Jina Reader JSON 모드로 사이트의 RSS URL을 자동 탐지:

```bash
curl -sH "Accept: application/json" "https://r.jina.ai/{URL}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['data'].get('external',{}).get('alternate',[]))"
```

## URL 변형으로 피드 탐색

사이트에 RSS가 명시되지 않아도 시도해볼 패턴:

```bash
curl -sL "{origin}/rss"
curl -sL "{origin}/feed"
curl -sL "{origin}/atom.xml"
curl -sL "{origin}/rss.xml"
curl -sL "{origin}/index.xml"
```

## Google News RSS (무인증)

```bash
# 키워드 검색
curl -sL "https://news.google.com/rss/search?q={검색어}&hl=ko&gl=KR&ceid=KR:ko"

# 토픽별 (TECHNOLOGY, BUSINESS, SCIENCE, SPORTS, HEALTH, WORLD)
curl -sL "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ko&gl=KR&ceid=KR:ko"

# 시간 필터: when:1h, when:7d, when:12m, after:YYYY-MM-DD
curl -sL "https://news.google.com/rss/search?q={검색어}+when:7d&hl=ko&gl=KR&ceid=KR:ko"
```

## 한국 언론사 RSS

전부 무인증. 바로 curl로 접근 가능.

```bash
# SBS 뉴스
curl -sL "https://news.sbs.co.kr/news/rss.do"

# 조선일보
curl -sL "http://www.chosun.com/site/data/rss/rss.xml"

# 중앙일보
curl -sL "http://rss.joinsmsn.com/joins_news_list.xml"

# 동아일보
curl -sL "http://rss.donga.com/total.xml"

# 경향신문
curl -sL "http://www.khan.co.kr/rss/rssdata/total_news.xml"

# 매일경제
curl -sL "http://file.mk.co.kr/news/rss/rss_30000001.xml"

# MBC 뉴스
curl -sL "http://imnews.imbc.com/rss/news/news_00.xml"

# 한국경제
curl -sL "https://www.hankyung.com/feed/all-news"

# 연합뉴스
curl -sL "https://www.yonhapnewsagency.com/RSS/headline.xml"
```

## 블로그/플랫폼 RSS

```bash
# 네이버 블로그
curl -sL "https://rss.blog.naver.com/{BLOG_ID}.xml"

# 티스토리
curl -sL "https://{blogname}.tistory.com/rss"

# 벨로그
curl -sL "https://v2.velog.io/rss/@{username}"

# Substack
curl -sL "https://{publication}.substack.com/feed"

# GitHub 릴리즈 (Atom)
curl -sL "https://github.com/{owner}/{repo}/releases.atom"

# YouTube 채널
curl -sL "https://www.youtube.com/feeds/videos.xml?channel_id={id}"

# HN (hnrss.org — 비공식이지만 안정적)
curl -sL "https://hnrss.org/frontpage"
```

## feedparser 파싱

```python
import feedparser

feed = feedparser.parse("FEED_URL")
for e in feed.entries[:10]:
    print(f"{e.title} — {e.link}")
    if hasattr(e, 'summary'):
        print(f"  {e.summary[:200]}")
```

## SearXNG (무인증 메타검색)

공개 인스턴스에서 JSON 검색 가능. 인스턴스별로 JSON 지원 여부 다름.

```bash
# 공개 인스턴스 목록: https://searx.space
curl -sL "https://search.mdosch.de/search?q={검색어}&format=json" \
  -H "User-Agent: insane-search/1.0"
```
