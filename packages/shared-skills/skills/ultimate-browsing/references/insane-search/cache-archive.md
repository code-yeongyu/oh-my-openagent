# 캐시 & 아카이브 (surrogate 경로)

> 원본 사이트가 차단되었을 때 캐시/아카이브된 **사본**으로 접근.
> 2026-08-09 실측 probe 기준으로 정렬. 각 경로는 생명 주기가 짧다 — 이 파일도
> 90일마다 재검증 대상. (당일 probe: 기존 기대 경로 6개 중 4개 사망 또는 스텁 반환.)

## 의존성

없음 (curl만 사용). 수동 경로이며, 자동화는 엔진 Phase 2.5(`engine/surrogates.yaml`)가 담당한다.

## 엔진 자동 폴백 (Phase 2.5)

`waf_profiles.yaml`의 `fallback_when_challenge`가 `surrogate_wayback`을 앞에 두므로,
그리드 실패 후 브라우저 실행 전에 아카이브 경로를 먼저 시도한다.
성공 시 `FetchResult.provenance = "snapshot"`, `snapshot_timestamp` = 아카이브의 자체 타임스탬프,
`trust = "archive"`가 채워진다. **사본이므로 반드시 날짜와 함께 인용할 것.**
`--allow-proxy` 없이는 `kind: proxy` 엔트리는 절대 실행되지 않으며, 프록시에는
Cookie/Authorization 헤더를 보내지 않는다 (중계자 = 구조적 MITM).

## 1. Wayback Machine (Internet Archive) — 1순위

**2026-08-09 probe: 정상 동작.** `available` API가 200 JSON으로 스냅샷 URL과
타임스탬프를 돌려준다 — 출처(provenance) 확보에 가장 좋은 primitive.

```bash
# 스냅샷 존재 여부 + 최신 스냅샷 URL/타임스탬프 (진입점으로 이것을 쓸 것)
curl -sL "https://archive.org/wayback/available?url={URL}"

# 반환 JSON의 archived_snapshots.closest.url 로 접근
curl -sL "https://web.archive.org/web/{timestamp}/{URL}"
```

> **CDX API 주의**: 이전 버전이 권장하던 `web.archive.org/cdx/search/cdx`는
> 2026-08 probe에서 503 반환. 스냅샷 열거가 필요 없으면 `available` API만 사용.

**성공 조건**: 크롤링 대상이었던 공개 URL
**실패 조건**: robots.txt로 차단된 사이트, 스냅샷이 없는 URL, SPA 스냅샷 (렌더링 안 됨)

## 2. archive.today — 2순위

사용자 제출 아카이브. 페이월 기사, 삭제된 콘텐츠에 특히 유용.
**2026-08 probe: 429 rate-limit이 잦고 도메인이 수시로 회전** (archive.ph → archive.md 관찰).
하나가 차단되면 다른 도메인을 순회한다 (엔진 `host_rotation`과 동일 패턴).

```bash
# 최신 스냅샷 조회 — 도메인 회전은 필수 경로, 예외 처리 아님
for domain in archive.ph archive.md archive.li archive.is; do
  resp=$(curl -sL -o /dev/null -w "%{http_code}" "https://$domain/newest/{URL}")
  if [ "$resp" = "200" ] || [ "$resp" = "302" ]; then
    echo "성공: https://$domain/newest/{URL}"
    curl -sL "https://$domain/newest/{URL}"
    break
  fi
done
```

**주의**: 429 응답에도 수 KB 본문이 딸려 오므로 상태코드 대신 본문 검증이 필요하다.

## 3. AMP 캐시 — 강등 (사실상 무용)

과거 1순위였으나 **2026-08 probe에서 사실상 무력화**:
`{host}.cdn.ampproject.org/c/s/...`가 HTTP 200을 돌려주지만, 실제 본문은
**322바이트짜리 `<TITLE>Redirecting</TITLE>` meta-refresh** — 대상은 다시 **원본(차단된) 페이지**다.
이걸 성공으로 착각하면 에이전트가 차단 페이지로 되돌아가는 루프가 생긴다.

엔진은 `engine/validators.py:is_redirect_stub`으로 이 패턴을 CHALLENGE 판정한다
(3KB 미만 + meta-refresh/JS redirect + 대상 호스트 재등장 조합).
수동 사용도 권장하지 않는다.

## 4. Google Cache — 사망 확정

**2024년 7월 종료** 후로도 `webcache.googleusercontent.com`이 HTTP 200 + 수십 KB의
본문을 반환하지만, 실제로는 `<title>Google Search</title>` 인터스티셜 + JS 리다이렉트다
(2026-08 probe 재확인). **캐시가 아니라 검색 홈이다.**
엔진은 `INTERSTITIAL_TITLE_MARKERS`로 판정해 성공 집계에서 배제한다.

## 시도 순서 (probe 근거)

```
1. Wayback available API → 스냅샷 URL + 타임스탬프 (provenance까지 확보)
2. archive.today 도메인 회전 (429 대비, 본문 검증 필수)
3. AMP 캐시: 시도하지 않음 (redirect stub → 원본으로 회귀)
4. Google Cache: 시도하지 않음 (사망, 검색 인터스티셜 반환)
```
