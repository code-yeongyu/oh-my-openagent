# 메타데이터 추출 — OGP / JSON-LD / Schema.org

> HTML을 받았을 때 구조화된 데이터를 추출하는 보조 기법.
> 본문 전체를 못 가져와도 제목, 요약, 가격, 프로필 등 핵심 정보를 확보할 수 있다.

## 의존성

없음 (curl + python3 기본 모듈).

## OGP (Open Graph Protocol) 메타태그

대부분의 사이트가 소셜 공유용으로 삽입. 제목 + 설명 + 이미지 확보 가능.

```bash
curl -sL -H "User-Agent: Mozilla/5.0 ..." "{URL}" | \
  python3 -c "
import sys, re
html = sys.stdin.read()
for m in re.findall(r'<meta property=\"og:(\w+)\" content=\"([^\"]*?)\"', html):
    print(f'og:{m[0]} = {m[1]}')
for m in re.findall(r'<meta name=\"description\" content=\"([^\"]*?)\"', html):
    print(f'description = {m}')
"
```

## JSON-LD (Schema.org 구조화 데이터)

**가장 가치 높은 추출 대상.** 상품, 기사, 프로필 등 구조화된 정보가 JSON으로 들어있다.

```bash
curl -sL "{URL}" | \
  python3 -c "
import sys, re, json
html = sys.stdin.read()
blocks = re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.DOTALL)
for b in blocks:
    try:
        data = json.loads(b)
        print(json.dumps(data, ensure_ascii=False, indent=2))
    except:
        pass
"
```

### 실제 사례

**쿠팡 검색 결과** — `CollectionPage` + `ItemList`:
```json
{
  "@type": "CollectionPage",
  "mainEntity": {
    "@type": "ItemList",
    "itemListElement": [
      {
        "@type": "ListItem",
        "item": {
          "@type": "Product",
          "name": "...",
          "offers": { "price": 29900 }
        }
      }
    ]
  }
}
```

**LinkedIn 프로필** — `Person`:
```json
{
  "@type": "Person",
  "name": "...",
  "jobTitle": "...",
  "alumniOf": [
    { "@type": "Organization", "name": "..." }
  ]
}
```

**뉴스 기사** — `NewsArticle`:
```json
{
  "@type": "NewsArticle",
  "headline": "...",
  "datePublished": "2026-04-16",
  "author": { "name": "..." },
  "articleBody": "..."
}
```

## Next.js RSC 페이로드 (요즘IT 등)

Next.js App Router 사이트는 `self.__next_f.push()` 스크립트에 콘텐츠가 포함됨.

```bash
curl -sL "{URL}" | \
  python3 -c "
import sys, re
html = sys.stdin.read()
chunks = re.findall(r'self\.__next_f\.push\(\[1,\"(.*?)\"\]\)', html)
text = ''.join(chunks)
# 한국어 텍스트 추출 (유니코드 이스케이프 디코딩)
decoded = text.encode().decode('unicode_escape', errors='ignore')
print(decoded[:3000])
"
```

## 활용 시점

메타데이터 추출은 **독립 방법이 아니라 보조 기법**이다.
어떤 Phase에서든 HTML을 받으면 같이 실행:

- Phase 1에서 curl로 HTML 받음 → JSON-LD도 추출
- Phase 2에서 curl_cffi로 HTML 받음 → JSON-LD도 추출
- Phase 3에서 Playwright로 DOM 받음 → `browser_evaluate`로 JSON-LD 추출

본문은 못 가져와도 JSON-LD에서 **상품 가격, 기사 요약, 프로필 정보**는 확보될 수 있다.
