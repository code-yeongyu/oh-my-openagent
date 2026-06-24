# 네이버 계열 접근 전략

> 네이버 서비스별로 접근 방법이 다르다. 블로그는 모바일 URL, 뉴스/증권은 Jina Reader.

## 네이버 블로그

WebFetch 차단. 모바일 URL 변환 + iPhone UA로 접근.

```bash
# blog.naver.com/{ID}/{NO} → m.blog.naver.com 변환
curl -sL \
  -H "User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" \
  -H "Accept-Language: ko-KR,ko;q=0.9" \
  -H "Referer: https://m.naver.com/" \
  "https://m.blog.naver.com/PostView.naver?blogId={ID}&logNo={NO}"
```

RSS도 가능 (최신 50개, 본문 약 300자):
```bash
curl -sL "https://rss.blog.naver.com/{BLOG_ID}.xml"
```

## 네이버 뉴스

Jina Reader로 완전 접근 가능.

```bash
# 기사 목록
curl -s "https://r.jina.ai/https://news.naver.com/"

# 개별 기사
curl -s "https://r.jina.ai/https://n.news.naver.com/article/{press_id}/{article_id}"
```

## 네이버 증권

Jina Reader로 실시간 주가, 주요 뉴스 접근.

```bash
curl -s "https://r.jina.ai/https://finance.naver.com/item/main.naver?code={종목코드}"
```

## 네이버 금융 시세 (비공식, 무인증)

인증 불필요. 주가 시계열 데이터 JSON 반환.

```bash
# 일봉 시세 (삼성전자=005930)
curl -sL "https://api.finance.naver.com/siseJson.naver?symbol=005930&requestType=1&startTime=20240101&endTime=20241231&timeframe=day"

# 분봉
curl -sL "https://api.finance.naver.com/siseJson.naver?symbol=005930&requestType=0&timeframe=minute&count=200"
```

응답: `[[날짜, 시가, 고가, 저가, 종가, 거래량, 외국인거래율], ...]`

## 네이버 검색 (신원위장으로 직접 접근)

curl_cffi + 세션 쿠키 워밍으로 네이버 검색 결과를 직접 크롤링할 수 있다. API 키 불필요.

```python
from curl_cffi import requests
from urllib.parse import quote

s = requests.Session(impersonate="chrome124")
s.headers.update({
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://www.google.com/",
})
s.get("https://www.naver.com/", timeout=10)  # 쿠키 워밍
s.headers["Referer"] = "https://www.naver.com/"

# 통합 검색 (블로그+뉴스+웹 혼합)
r = s.get(f"https://search.naver.com/search.naver?query={quote('검색어')}")

# 블로그 탭
r = s.get(f"https://search.naver.com/search.naver?where=post&query={quote('검색어')}")

# 뉴스 탭
r = s.get(f"https://search.naver.com/search.naver?where=news&query={quote('검색어')}")
```

### 추출 가능한 데이터

| 탭 | URL 패턴 | 추출 |
|---|---|---|
| 통합 | `search.naver?query=` | 블로그 URL, 외부 링크, 뉴스 |
| 블로그 | `where=post&query=` | blog.naver.com URL, 제목, 스니펫 |
| 뉴스 | `where=news&query=` | n.news.naver.com URL, 제목 |

### 한국어 키워드 검색의 핵심 경로

WebSearch는 한국어 신규 콘텐츠 인덱싱이 지연되지만, 네이버 검색은 한국어에 최적화되어 있다.
**한국 사이트 키워드 검색 → 네이버 검색 직접 접근이 가장 정확하고 빠르다.**

## 네이버 카페

로그인 + iframe 이중 장벽. 본문 직접 접근 불가.
fallback 체인에서 Phase 1~3을 시도하되, login/paywall 감지 시 "인증 필요"로 종료.

## 네이버 TV

yt-dlp로 접근 (media.md 참조).

```bash
yt-dlp --dump-json "https://tv.naver.com/v/{video_id}"
```
