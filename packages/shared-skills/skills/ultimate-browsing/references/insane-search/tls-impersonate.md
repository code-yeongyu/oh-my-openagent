# TLS 임퍼소네이션 — curl_cffi

> TLS 핑거프린트(JA3/JA4) 기반 WAF를 우회하는 핵심 방법.
> 일반 curl/requests는 OpenSSL 핑거프린트라 즉시 차단되지만,
> curl_cffi는 실제 브라우저(Chrome/Safari/Firefox)의 TLS 핑거프린트를 복제한다.

## 의존성

```bash
python3 -c "import curl_cffi" 2>/dev/null || pip install curl_cffi -q
```

설치 후 사용 가능. **미설치를 이유로 이 스텝을 건너뛰지 않는다.**

## 다중 타겟 순차 시도

하나의 impersonate 타겟이 실패하면 다른 타겟으로 재시도한다.
**시도 순서: safari → chrome → firefox**

```python
from curl_cffi import requests

TARGETS = ["safari", "chrome", "firefox"]
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Referer": "https://www.google.com/",
}

def cffi_fetch(url, locale="ko-KR"):
    """다중 타겟 순차 시도 + 신원위장. 성공하면 (response, target) 반환."""
    from urllib.parse import urlparse
    origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    for target in TARGETS:
        try:
            session = requests.Session(impersonate=target)
            session.headers.update(HEADERS)
            session.headers["Accept-Language"] = f"{locale},{locale.split('-')[0]};q=0.9"
            session.headers["Referer"] = "https://www.google.com/"
            # 신원위장: 홈페이지 쿠키 워밍 → Referer 체인
            try:
                session.get(origin, timeout=10)
            except Exception:
                pass  # 홈 실패해도 본 요청은 시도
            session.headers["Referer"] = origin
            resp = session.get(url, timeout=20)
            # JS 필수 사이트 감지 → 나머지 타겟 시도 무의미
            if "behavioral-content" in resp.text or "sec-if-cpt" in resp.text:
                return None, None  # → Phase 3 Playwright
            if resp.status_code == 200 and len(resp.text) > 500:
                return resp, target
        except Exception:
            continue
    return None, None
```

## 임퍼소네이션 타겟 목록 (v0.15.0)

generic alias는 항상 최신 버전으로 해석된다. **2026년에 chrome99 같은 옛 버전은 WAF가 의심하므로 generic alias 사용 권장.**

| Alias | 해석 (2026.04) | 용도 |
|-------|---------------|------|
| `safari` | safari260 | **한국 사이트 최적** (쿠팡, 에펨코리아) |
| `chrome` | chrome146 | 범용 (Cloudflare, Akamai) |
| `firefox` | firefox135 | chrome/safari 실패 시 대안 |
| `chrome_android` | chrome131_android | 모바일 API 엔드포인트 |
| `safari_ios` | safari260_ios | iOS 모바일 |

<details>
<summary>핀 버전 전체 (클릭)</summary>

```
chrome99, chrome100, chrome101, chrome104, chrome107, chrome110,
chrome116, chrome119, chrome120, chrome123, chrome124, chrome131,
chrome133a, chrome136, chrome142, chrome145, chrome146,
chrome131_android, edge99, edge101,
safari15_3, safari15_5, safari17_0, safari17_2_ios,
safari18_0, safari18_0_ios, safari260, safari260_ios,
firefox133, firefox135
```

</details>

## WAF별 최적 전략

| WAF | 최적 타겟 | 추가 조건 | 성공률 |
|-----|-----------|-----------|--------|
| F5 BIG-IP (쿠팡) | `safari` | `Referer: https://www.coupang.com/` | ~70% |
| Cloudflare (TLS만) | `chrome` | Sec-Fetch-* 헤더 추가 | ~80% |
| Akamai | `chrome` | 레지덴셜 프록시 병행 | 80-90% |
| AWS WAF | `chrome` | — | ~80% |
| CloudFront (요즘IT) | 불필요 | 일반 curl + Chrome UA로 충분 | 100% |

## 세션과 쿠키

```python
from curl_cffi import requests

# 세션 유지 (쿠키 자동 관리)
session = requests.Session(impersonate="safari")

# 첫 요청으로 세션 쿠키 획득
session.get("https://www.coupang.com/")

# 이후 요청에 쿠키 자동 전달
resp = session.get("https://www.coupang.com/np/search?q=키보드")
```

## 콤보: nodriver/FlareSolverr → curl_cffi

JS 챌린지 사이트는 브라우저로 쿠키를 획득한 뒤 curl_cffi로 고속 처리:

```python
# 1. nodriver로 cf_clearance 쿠키 획득
import nodriver as uc
browser = await uc.start(headless=True)
page = await browser.get("https://cf-protected-site.com")
await page.cf_verify()
cookies = await browser.cookies.get_all()

# 2. curl_cffi Session에 쿠키 전달
from curl_cffi import requests
session = requests.Session(impersonate="chrome")
for c in cookies:
    session.cookies.set(c["name"], c["value"])
resp = session.get("https://cf-protected-site.com/api/data")
```

## 비동기 (async)

```python
import asyncio
from curl_cffi.requests import AsyncSession

async def fetch_many(urls):
    async with AsyncSession(impersonate="chrome") as session:
        tasks = [session.get(url) for url in urls]
        return await asyncio.gather(*tasks)
```

## HTTP/3 (v0.15.0+)

```python
from curl_cffi import requests
from curl_cffi.const import CurlHttpVersion

resp = requests.get(
    "https://www.cloudflare.com/",
    impersonate="chrome",
    http_version=CurlHttpVersion.V3,
)
```

WAF 벤더들이 아직 HTTP/3 핑거프린트를 적극 활용하지 않아 우회 효과가 높다.

## 대안 라이브러리

curl_cffi 실패 시 대안:

| 라이브러리 | 설치 | 특징 |
|-----------|------|------|
| primp | `pip install primp` | Rust 기반, Firefox 148까지, 고성능 |
| wreq/rnet | `pip install wreq` | Rust 기반, 100+ 디바이스 프로필 |
| tls-client2 | `pip install tls-client2` | Go 기반 포크, 동기만 |

```python
# primp 예시
import primp
client = primp.Client(impersonate="chrome_146")
resp = client.get("https://example.com")
```

## curl_cffi가 못 뚫는 것

| 방어 수단 | curl_cffi | 대응 |
|-----------|-----------|------|
| TLS/JA3 핑거프린트 | 우회 가능 | 핵심 기능 |
| HTTP/2 SETTINGS 핑거프린트 | 우회 가능 | impersonate에 포함 |
| HTTP/3 QUIC 핑거프린트 | 우회 가능 (v0.15+) | 신규 |
| JS 챌린지 (Turnstile 등) | **불가** | → nodriver 또는 Playwright |
| CAPTCHA | **불가** | → 2captcha/CapSolver |
| IP 평판 (데이터센터) | **불가** | → 프록시/VPN |
| 행동 분석 (마우스/타이밍) | **불가** | → 실제 브라우저 |

JS 챌린지가 걸린 사이트는 → [playwright.md](playwright.md) 로 넘긴다.
