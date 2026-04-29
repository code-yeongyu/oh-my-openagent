---
name: agent-browser
description: 웹 테스트, 폼 작성, 스크린샷, 데이터 추출을 위한 브라우저 상호작용을 자동화합니다. 사용자가 웹사이트 탐색, 웹 페이지 상호작용, 폼 작성, 스크린샷 촬영, 웹 애플리케이션 테스트, 또는 웹 페이지에서 정보 추출이 필요할 때 사용하세요.
---

# agent-browser를 사용한 브라우저 자동화

## 빠른 시작

```bash
agent-browser open <url>        # 페이지로 이동
agent-browser snapshot -i       # ref가 포함된 인터랙티브 요소 가져오기
agent-browser click @e1         # ref로 요소 클릭
agent-browser fill @e2 "text"   # ref로 입력 필드 채우기
agent-browser close             # 브라우저 종료
```

## 핵심 워크플로우

1. 이동: `agent-browser open <url>`
2. 스냅샷: `agent-browser snapshot -i` (`@e1`, `@e2` 같은 ref가 포함된 요소 반환)
3. 스냅샷의 ref를 사용해 상호작용
4. 페이지 이동이나 큰 DOM 변경 후 다시 스냅샷

## 명령어

### 탐색
```bash
agent-browser open <url>      # URL로 이동 (별칭: goto, navigate)
agent-browser back            # 뒤로 가기
agent-browser forward         # 앞으로 가기
agent-browser reload          # 페이지 새로고침
agent-browser close           # 브라우저 종료 (별칭: quit, exit)
```

### 스냅샷 (페이지 분석)
```bash
agent-browser snapshot            # 전체 접근성 트리
agent-browser snapshot -i         # 인터랙티브 요소만 (권장)
agent-browser snapshot -i -C      # 커서로 상호작용 가능한 요소 포함 (onclick이 있는 div 등)
agent-browser snapshot -c         # 컴팩트 (빈 구조 요소 제거)
agent-browser snapshot -d 3       # 깊이를 3으로 제한
agent-browser snapshot -s "#main" # CSS 셀렉터로 범위 지정
agent-browser snapshot -i -c -d 5 # 옵션 결합
```

`-C` 플래그는 표준 button/link 대신 커스텀 클릭 가능 요소(div, span)를 사용하는 최신 웹 앱에 유용합니다.

### 상호작용 (스냅샷의 @ref 사용)
```bash
agent-browser click @e1           # 클릭 (--new-tab 으로 새 탭에서 열기)
agent-browser dblclick @e1        # 더블 클릭
agent-browser focus @e1           # 요소 포커스
agent-browser fill @e2 "text"     # 지우고 입력
agent-browser type @e2 "text"     # 지우지 않고 입력
agent-browser keyboard type "text"     # 실제 키 입력으로 타이핑 (셀렉터 없음, 현재 포커스)
agent-browser keyboard inserttext "text"  # 키 이벤트 없이 텍스트 삽입 (셀렉터 없음)
agent-browser press Enter         # 키 누르기
agent-browser press Control+a     # 키 조합
agent-browser keydown Shift       # 키 누른 채 유지
agent-browser keyup Shift         # 키 떼기
agent-browser hover @e1           # 호버
agent-browser check @e1           # 체크박스 체크
agent-browser uncheck @e1         # 체크박스 체크 해제
agent-browser select @e1 "value"  # 드롭다운 선택
agent-browser scroll down 500     # 페이지 스크롤 (--selector <sel> 로 컨테이너 지정)
agent-browser scrollintoview @e1  # 요소를 보이도록 스크롤 (별칭: scrollinto)
agent-browser drag @e1 @e2        # 드래그 앤 드롭
agent-browser upload @e1 file.pdf # 파일 업로드
```

### 정보 가져오기
```bash
agent-browser get text @e1        # 요소 텍스트 가져오기
agent-browser get html @e1        # innerHTML 가져오기
agent-browser get value @e1       # 입력값 가져오기
agent-browser get attr @e1 href   # 속성 가져오기
agent-browser get title           # 페이지 제목 가져오기
agent-browser get url             # 현재 URL 가져오기
agent-browser get count ".item"   # 일치하는 요소 개수
agent-browser get box @e1         # 바운딩 박스 가져오기
agent-browser get styles @e1      # 계산된 스타일 가져오기
```

### 상태 확인
```bash
agent-browser is visible @e1      # 표시 여부 확인
agent-browser is enabled @e1      # 활성화 여부 확인
agent-browser is checked @e1      # 체크 여부 확인
```

### 스크린샷 & PDF
```bash
agent-browser screenshot          # 스크린샷 (경로 미지정 시 임시 디렉토리에 저장)
agent-browser screenshot path.png # 파일로 저장
agent-browser screenshot --full   # 전체 페이지
agent-browser screenshot --annotate   # 번호 라벨이 포함된 주석 스크린샷
agent-browser pdf output.pdf      # PDF로 저장
```

주석 스크린샷은 인터랙티브 요소에 번호 라벨 `[N]`을 오버레이합니다. 각 라벨은 ref `@eN`에 대응하므로, ref는 시각적 워크플로우와 텍스트 워크플로우 모두에서 동작합니다:
```bash
agent-browser screenshot --annotate ./page.png
# 출력: [1] @e1 button "Submit", [2] @e2 link "Home", [3] @e3 textbox "Email"
agent-browser click @e2     # [2]로 라벨링된 "Home" 링크 클릭
```

### 비디오 녹화
```bash
agent-browser record start ./demo.webm    # 녹화 시작 (현재 URL + 상태 사용)
agent-browser click @e1                   # 액션 수행
agent-browser record stop                 # 중지 후 비디오 저장
agent-browser record restart ./take2.webm # 현재 녹화 중지 + 새 녹화 시작
```
녹화는 새로운 컨텍스트를 생성하지만 세션의 쿠키/스토리지는 유지합니다.

### 대기
```bash
agent-browser wait @e1                     # 요소 대기
agent-browser wait 2000                    # 밀리초 대기
agent-browser wait --text "Success"        # 텍스트 대기
agent-browser wait --url "**/dashboard"    # URL 패턴 대기
agent-browser wait --load networkidle      # 네트워크 유휴 상태 대기
agent-browser wait --fn "window.ready"     # JS 조건 대기
```

로드 상태: `load`, `domcontentloaded`, `networkidle`

### 마우스 제어
```bash
agent-browser mouse move 100 200      # 마우스 이동
agent-browser mouse down left         # 버튼 누르기 (left/right/middle)
agent-browser mouse up left           # 버튼 떼기
agent-browser mouse wheel 100         # 휠 스크롤
```

### 시맨틱 로케이터 (ref 대안)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search..." fill "query"
agent-browser find alt "Logo" click
agent-browser find title "Close" click
agent-browser find testid "submit-btn" click
agent-browser find first ".item" click
agent-browser find last ".item" click
agent-browser find nth 2 "a" text
```

액션: `click`, `fill`, `type`, `hover`, `focus`, `check`, `uncheck`, `text`
옵션: `--name <name>` (접근성 이름으로 role 필터링), `--exact` (정확한 텍스트 일치 요구)

### 브라우저 설정
```bash
agent-browser set viewport 1920 1080      # 뷰포트 크기 설정
agent-browser set device "iPhone 14"      # 기기 에뮬레이트
agent-browser set geo 37.7749 -122.4194   # 지오로케이션 설정
agent-browser set offline on              # 오프라인 모드 토글
agent-browser set headers '{"X-Key":"v"}' # 추가 HTTP 헤더
agent-browser set credentials user pass   # HTTP 기본 인증
agent-browser set media dark              # 컬러 스킴 에뮬레이트
```

### 쿠키 & 스토리지
```bash
agent-browser cookies                     # 모든 쿠키 가져오기
agent-browser cookies set name value      # 쿠키 설정
agent-browser cookies clear               # 쿠키 삭제

agent-browser storage local               # 모든 localStorage 가져오기
agent-browser storage local key           # 특정 키 가져오기
agent-browser storage local set k v       # 값 설정
agent-browser storage local clear         # 모두 지우기

agent-browser storage session             # sessionStorage에 동일하게 적용
```

### 네트워크
```bash
agent-browser network route <url>              # 요청 가로채기
agent-browser network route <url> --abort      # 요청 차단
agent-browser network route <url> --body '{}'  # 응답 모킹
agent-browser network unroute [url]            # 라우트 제거
agent-browser network requests                 # 추적된 요청 보기
agent-browser network requests --filter api    # 요청 필터링
```

### 탭 & 윈도우
```bash
agent-browser tab                 # 탭 목록
agent-browser tab new [url]       # 새 탭
agent-browser tab 2               # 탭 전환
agent-browser tab close           # 탭 닫기
agent-browser window new          # 새 창
```

### 프레임
```bash
agent-browser frame "#iframe"     # iframe으로 전환
agent-browser frame main          # 메인 프레임으로 복귀
```

### 다이얼로그
```bash
agent-browser dialog accept [text]  # 다이얼로그 수락 (선택적 prompt 텍스트 포함)
agent-browser dialog dismiss        # 다이얼로그 거부
```

### Diff (스냅샷, 스크린샷, URL 비교)
```bash
agent-browser diff snapshot                              # 현재 vs 마지막 스냅샷 비교
agent-browser diff snapshot --baseline before.txt        # 현재 vs 저장된 스냅샷 파일 비교
agent-browser diff snapshot --selector "#main" --compact # 범위 지정 스냅샷 diff
agent-browser diff screenshot --baseline before.png      # 베이스라인 대비 시각적 픽셀 diff
agent-browser diff screenshot --baseline b.png -o d.png  # diff 이미지를 사용자 정의 경로로 저장
agent-browser diff screenshot --baseline b.png -t 0.2    # 색상 임계값 조정 (0-1)
agent-browser diff url https://v1.com https://v2.com     # 두 URL 비교 (스냅샷 diff)
agent-browser diff url https://v1.com https://v2.com --screenshot  # 시각적 diff도 수행
agent-browser diff url https://v1.com https://v2.com --selector "#main"  # 요소로 범위 지정
```

### JavaScript
```bash
agent-browser eval "document.title"   # JavaScript 실행
agent-browser eval -b "base64code"    # base64로 인코딩된 JS 실행
agent-browser eval --stdin            # stdin에서 JS 읽기
```

### 디버그 & 프로파일링
```bash
agent-browser console                 # 콘솔 메시지 보기
agent-browser console --clear         # 콘솔 비우기
agent-browser errors                  # 페이지 오류 보기
agent-browser errors --clear          # 오류 비우기
agent-browser highlight @e1           # 요소 하이라이트
agent-browser trace start             # 트레이스 녹화 시작
agent-browser trace stop trace.zip    # 중지 후 트레이스 저장
agent-browser profiler start          # Chrome DevTools 프로파일링 시작
agent-browser profiler stop profile.json  # 중지 후 프로파일 저장
```

### 상태 관리
```bash
agent-browser state save auth.json    # 인증 상태 저장
agent-browser state load auth.json    # 인증 상태 로드
agent-browser state list              # 저장된 상태 파일 목록
agent-browser state show <file>       # 상태 요약 표시
agent-browser state rename <old> <new>  # 상태 파일 이름 변경
agent-browser state clear [name]      # 세션 상태 지우기
agent-browser state clear --all       # 저장된 모든 상태 지우기
agent-browser state clean --older-than <days>  # 오래된 상태 삭제
```

### 설치
```bash
agent-browser install                 # Chromium 브라우저 다운로드
agent-browser install --with-deps     # 시스템 의존성도 설치 (Linux)
```

## 전역 옵션

| 옵션 | 설명 |
|--------|-------------|
| `--session <name>` | 격리된 브라우저 세션 (`AGENT_BROWSER_SESSION` 환경변수) |
| `--session-name <name>` | 세션 상태 자동 저장/복원 (`AGENT_BROWSER_SESSION_NAME` 환경변수) |
| `--profile <path>` | 영구 브라우저 프로필 (`AGENT_BROWSER_PROFILE` 환경변수) |
| `--state <path>` | JSON 파일에서 스토리지 상태 로드 (`AGENT_BROWSER_STATE` 환경변수) |
| `--headers <json>` | URL의 origin에 한정된 HTTP 헤더 |
| `--executable-path <path>` | 사용자 정의 브라우저 바이너리 (`AGENT_BROWSER_EXECUTABLE_PATH` 환경변수) |
| `--extension <path>` | 브라우저 확장 프로그램 로드 (반복 가능; `AGENT_BROWSER_EXTENSIONS` 환경변수) |
| `--args <args>` | 브라우저 실행 인자 (`AGENT_BROWSER_ARGS` 환경변수) |
| `--user-agent <ua>` | 사용자 정의 User-Agent (`AGENT_BROWSER_USER_AGENT` 환경변수) |
| `--proxy <url>` | 프록시 서버 (`AGENT_BROWSER_PROXY` 환경변수) |
| `--proxy-bypass <hosts>` | 프록시 우회 호스트 (`AGENT_BROWSER_PROXY_BYPASS` 환경변수) |
| `--ignore-https-errors` | HTTPS 인증서 오류 무시 |
| `--allow-file-access` | file:// URL이 로컬 파일에 접근하도록 허용 |
| `-p, --provider <name>` | 클라우드 브라우저 프로바이더 (`AGENT_BROWSER_PROVIDER` 환경변수) |
| `--device <name>` | iOS 기기 이름 (`AGENT_BROWSER_IOS_DEVICE` 환경변수) |
| `--json` | 기계 판독 가능한 JSON 출력 |
| `--full, -f` | 전체 페이지 스크린샷 |
| `--annotate` | 번호 라벨이 포함된 주석 스크린샷 (`AGENT_BROWSER_ANNOTATE` 환경변수) |
| `--headed` | 브라우저 창 표시 (`AGENT_BROWSER_HEADED` 환경변수) |
| `--cdp <port\|wss://url>` | Chrome DevTools Protocol로 연결 |
| `--auto-connect` | 실행 중인 Chrome 자동 검색 (`AGENT_BROWSER_AUTO_CONNECT` 환경변수) |
| `--color-scheme <scheme>` | 컬러 스킴: dark, light, no-preference (`AGENT_BROWSER_COLOR_SCHEME` 환경변수) |
| `--download-path <path>` | 기본 다운로드 디렉토리 (`AGENT_BROWSER_DOWNLOAD_PATH` 환경변수) |
| `--native` | [실험적] 네이티브 Rust 데몬 사용 (`AGENT_BROWSER_NATIVE` 환경변수) |
| `--config <path>` | 사용자 정의 설정 파일 (`AGENT_BROWSER_CONFIG` 환경변수) |
| `--debug` | 디버그 출력 |

### 보안 옵션
| 옵션 | 설명 |
|--------|-------------|
| `--content-boundaries` | 페이지 출력을 경계 마커로 감싸기 (`AGENT_BROWSER_CONTENT_BOUNDARIES` 환경변수) |
| `--max-output <chars>` | 페이지 출력을 N 문자로 자르기 (`AGENT_BROWSER_MAX_OUTPUT` 환경변수) |
| `--allowed-domains <list>` | 쉼표로 구분된 허용 도메인 패턴 (`AGENT_BROWSER_ALLOWED_DOMAINS` 환경변수) |
| `--action-policy <path>` | 액션 정책 JSON 파일 경로 (`AGENT_BROWSER_ACTION_POLICY` 환경변수) |
| `--confirm-actions <list>` | 확인이 필요한 액션 카테고리 (`AGENT_BROWSER_CONFIRM_ACTIONS` 환경변수) |

## 설정 파일

영구 기본값을 위해 `agent-browser.json`을 생성하세요 (플래그 반복 불필요):

**위치 (낮은 우선순위에서 높은 우선순위 순):**
1. `~/.agent-browser/config.json` — 사용자 수준 기본값
2. `./agent-browser.json` — 프로젝트 수준 오버라이드
3. `AGENT_BROWSER_*` 환경 변수
4. CLI 플래그가 모든 것을 오버라이드

```json
{
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data",
  "native": true
}
```

## 예제: 폼 제출

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# 출력: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # 결과 확인
```

## 예제: 저장된 상태로 인증

```bash
# 한 번 로그인
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# 이후 세션: 저장된 상태 로드
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

### 헤더 기반 인증 (로그인 흐름 건너뛰기)
```bash
# 헤더는 api.example.com에만 적용됨
agent-browser open api.example.com --headers '{"Authorization": "Bearer <token>"}'
# 다른 도메인으로 이동 - 헤더 전송 안 됨 (안전)
agent-browser open other-site.com
# 전역 헤더 (모든 도메인)
agent-browser set headers '{"X-Custom-Header": "value"}'
```

### 인증 볼트
```bash
# 자격 증명을 로컬에 저장 (암호화). LLM은 비밀번호를 절대 보지 못함.
echo "pass" | agent-browser auth save github --url https://github.com/login --username user --password-stdin
agent-browser auth login github
```

## 세션 & 영구 프로필

### 세션 (병렬 브라우저)
```bash
agent-browser --session test1 open site-a.com
agent-browser --session test2 open site-b.com
agent-browser session list
```

### 세션 영속성 (자동 저장/복원)
```bash
agent-browser --session-name twitter open twitter.com
# 한 번 로그인하면, 재시작 후에도 상태가 자동으로 유지됨
# 상태 파일은 ~/.agent-browser/sessions/ 에 저장
```

### 영구 프로필
브라우저 재시작 시에도 쿠키, localStorage, IndexedDB, 서비스 워커, 캐시, 로그인 세션을 유지합니다.
```bash
agent-browser --profile ~/.myapp-profile open myapp.com
# 또는 환경 변수로
AGENT_BROWSER_PROFILE=~/.myapp-profile agent-browser open myapp.com
```

## JSON 출력 (파싱용)

기계 판독 가능한 출력을 위해 `--json` 추가:
```bash
agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

## 로컬 파일

```bash
agent-browser --allow-file-access open file:///path/to/document.pdf
agent-browser --allow-file-access open file:///path/to/page.html
```

## CDP 모드

```bash
agent-browser connect 9222                                          # 로컬 CDP 포트
agent-browser --cdp 9222 snapshot                                   # 각 명령에 직접 CDP
agent-browser --cdp "wss://browser-service.com/cdp?token=..." snapshot  # WebSocket을 통한 원격
agent-browser --auto-connect snapshot                               # 실행 중인 Chrome 자동 검색
```

## 클라우드 프로바이더

```bash
# Browserbase
BROWSERBASE_API_KEY="key" BROWSERBASE_PROJECT_ID="id" agent-browser -p browserbase open example.com

# Browser Use
BROWSER_USE_API_KEY="key" agent-browser -p browseruse open example.com

# Kernel
KERNEL_API_KEY="key" agent-browser -p kernel open example.com
```

## iOS 시뮬레이터

```bash
agent-browser device list                                        # 사용 가능한 시뮬레이터 목록
agent-browser -p ios --device "iPhone 16 Pro" open example.com   # Safari 실행
agent-browser -p ios snapshot -i                                 # 데스크톱과 동일한 명령어
agent-browser -p ios tap @e1                                     # 탭
agent-browser -p ios swipe up                                    # 모바일 전용
agent-browser -p ios close                                       # 세션 종료
```

## 네이티브 모드 (실험적)

직접 CDP를 사용하는 순수 Rust 데몬 — Node.js/Playwright 불필요:
```bash
agent-browser --native open example.com
# 또는: export AGENT_BROWSER_NATIVE=1
# 또는: agent-browser.json에 {"native": true}
```

---
설치: `bun add -g agent-browser && agent-browser install`. 모든 명령어는 `agent-browser --help` 실행. 저장소: https://github.com/vercel-labs/agent-browser
