# 캐시 & 아카이브

> 원본 사이트가 차단되었을 때 캐시된/아카이브된 버전으로 접근.
> Google Cache는 2024년 7월 종료됨 — AMP 캐시와 archive.today가 대체.

## 의존성

없음 (curl만 사용).

## 1. Google AMP 캐시

AMP 지원 사이트의 캐시 버전. 뉴스/미디어 사이트에 효과적.

```bash
# URL 변환: domain의 .을 -로 → cdn.ampproject.org
# 예: www.bbc.com → www-bbc-com.cdn.ampproject.org

python3 -c "
from urllib.parse import urlparse
url = '{URL}'
p = urlparse(url)
domain_sub = p.netloc.replace('.', '-')
print(f'https://{domain_sub}.cdn.ampproject.org/c/s/{p.netloc}{p.path}')
"

# 변환된 URL로 접근
curl -sL "https://{domain-with-dashes}.cdn.ampproject.org/c/s/{netloc}{path}"
```

**성공 조건**: 사이트가 AMP 페이지를 제공하는 경우 (대부분의 뉴스/미디어)
**실패 조건**: AMP 미지원 사이트, 매우 최신 콘텐츠 (캐시 지연 ~15초)

## 2. archive.today

사용자 제출 아카이브. 페이월 기사, 삭제된 콘텐츠에 특히 유용.
도메인이 여러 개 — 하나가 차단되면 다른 것 사용.

```bash
# 최신 스냅샷 조회
curl -sL "https://archive.ph/newest/{URL}"

# 도메인 로테이션 (하나가 차단되면 다른 것)
for domain in archive.ph archive.is archive.md archive.vn archive.li; do
  resp=$(curl -sL -o /dev/null -w "%{http_code}" "https://$domain/newest/{URL}")
  if [ "$resp" = "200" ] || [ "$resp" = "302" ]; then
    echo "성공: https://$domain/newest/{URL}"
    curl -sL "https://$domain/newest/{URL}"
    break
  fi
done
```

**성공 조건**: 누군가 이전에 해당 URL을 아카이브한 경우
**실패 조건**: 아카이브된 적 없는 URL

## 3. Wayback Machine (Internet Archive)

```bash
# 스냅샷 존재 여부 확인
curl -sL "https://archive.org/wayback/available?url={URL}"

# 최신 스냅샷으로 접근
curl -sL "https://web.archive.org/web/{URL}"

# CDX API — 스냅샷 목록 조회
curl -sL "https://web.archive.org/cdx/search/cdx?url={URL}&output=json&fl=timestamp,statuscode&limit=5"
```

**성공 조건**: 크롤링 대상이었던 공개 URL
**실패 조건**: robots.txt로 차단된 사이트, SPA (렌더링 안 됨), iframe 기반 사이트

## 4. Google Cache (종료됨)

> **2024년 7월 종료.** `webcache.googleusercontent.com`은 더 이상 동작하지 않음.
> 대신 AMP 캐시 또는 archive.today를 사용.

## 시도 순서

```
1. AMP 캐시 (뉴스/미디어 사이트 → 높은 성공률)
2. archive.today (페이월/삭제 콘텐츠 → 아카이브 있으면 확실)
3. Wayback Machine (오래된 콘텐츠 → 스냅샷 있으면 확실)
```
