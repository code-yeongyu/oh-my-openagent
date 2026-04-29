# Dev Browser 설치 가이드

이 가이드는 macOS, Linux, Windows 등 모든 플랫폼의 설치 방법을 다룹니다.

## 사전 요구사항

- npm이 포함된 [Node.js](https://nodejs.org) v18 이상
- Git (스킬 클론용)

## 설치

### 1단계: 스킬 클론

```bash
# dev-browser를 임시 위치에 클론
git clone https://github.com/sawyerhood/dev-browser /tmp/dev-browser-skill

# 스킬 디렉토리로 복사 (필요에 따라 경로 조정)
# oh-my-opencode의 경우: 이미 번들 포함됨
# 수동 설치의 경우:
mkdir -p ~/.config/opencode/skills
cp -r /tmp/dev-browser-skill/skills/dev-browser ~/.config/opencode/skills/dev-browser

# 정리
rm -rf /tmp/dev-browser-skill
```

**Windows (PowerShell):**
```powershell
# dev-browser를 임시 위치에 클론
git clone https://github.com/sawyerhood/dev-browser $env:TEMP\dev-browser-skill

# 스킬 디렉토리로 복사
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\skills"
Copy-Item -Recurse "$env:TEMP\dev-browser-skill\skills\dev-browser" "$env:USERPROFILE\.config\opencode\skills\dev-browser"

# 정리
Remove-Item -Recurse -Force "$env:TEMP\dev-browser-skill"
```

### 2단계: 의존성 설치

```bash
cd ~/.config/opencode/skills/dev-browser
npm install
```

**Windows (PowerShell):**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
npm install
```

### 3단계: 서버 시작

#### 독립 실행 모드 (새 브라우저 인스턴스)

**macOS/Linux:**
```bash
cd ~/.config/opencode/skills/dev-browser
./server.sh &
# 또는 헤드리스로:
./server.sh --headless &
```

**Windows (PowerShell):**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js"
# 또는 헤드리스로:
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js", "--headless"
```

**Windows (CMD):**
```cmd
cd %USERPROFILE%\.config\opencode\skills\dev-browser
start /B node server.js
```

스크립트 실행 전 `Ready` 메시지를 기다리세요.

#### 확장 프로그램 모드 (기존 Chrome 사용)

**macOS/Linux:**
```bash
cd ~/.config/opencode/skills/dev-browser
npm run start-extension &
```

**Windows (PowerShell):**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "start-extension"
```

`Extension connected` 메시지를 기다리세요.

## Chrome 확장 프로그램 설정 (선택)

Chrome 확장 프로그램을 사용하면 모든 로그인 세션이 있는 기존 Chrome 브라우저를 제어할 수 있습니다.

### 설치

1. [최신 릴리스](https://github.com/sawyerhood/dev-browser/releases/latest)에서 `extension.zip`을 다운로드
2. 영구 위치에 압축 해제:
   - **macOS/Linux:** `~/.dev-browser-extension`
   - **Windows:** `%USERPROFILE%\.dev-browser-extension`
3. Chrome 열기 → `chrome://extensions`
4. "개발자 모드" 활성화 (오른쪽 상단 토글)
5. "압축해제된 확장 프로그램 로드" 클릭 → 압축 해제된 폴더 선택

### 사용법

1. Chrome 툴바에서 Dev Browser 확장 프로그램 아이콘 클릭
2. "Active"로 토글
3. 확장 프로그램 릴레이 서버 시작 (위 참조)
4. dev-browser 스크립트 사용 - 기존 Chrome을 제어합니다

## 문제 해결

### 서버가 시작되지 않음

**Node.js 버전 확인:**
```bash
node --version  # v18+ 이어야 함
```

**포트 가용성 확인:**
```bash
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

### Playwright 설치 문제

Chromium 설치에 실패하는 경우:
```bash
npx playwright install chromium
```

### Windows 전용 문제

**실행 정책:**
PowerShell 스크립트가 차단된 경우:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**경로 문제:**
경로에는 슬래시 또는 이스케이프된 백슬래시 사용:
```powershell
# 좋음
cd "$env:USERPROFILE/.config/opencode/skills/dev-browser"
# 이것도 좋음
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
```

### 확장 프로그램이 연결되지 않음

1. 확장 프로그램이 "Active"인지 확인 (아이콘 클릭으로 토글)
2. 릴레이 서버가 실행 중인지 확인 (`npm run start-extension`)
3. 콘솔에서 `Extension connected` 메시지 확인
4. `chrome://extensions`에서 확장 프로그램 다시 로드 시도

## 권한

Claude Code에서 권한 프롬프트를 건너뛰려면 `~/.claude/settings.json`에 추가:

```json
{
  "permissions": {
    "allow": ["Skill(dev-browser:dev-browser)", "Bash(npx tsx:*)"]
  }
}
```

## 업데이트

```bash
cd ~/.config/opencode/skills/dev-browser
git pull
npm install
```

**Windows:**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
git pull
npm install
```
