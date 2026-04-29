# CLI 레퍼런스

배포된 `oh-my-opencode` CLI에 대한 완전한 레퍼런스입니다. 리네임 전환 기간 동안, OpenCode 플러그인 등록은 이제 `opencode.json` 안에서 `oh-my-openagent`를 우선합니다.

## 기본 사용법

```bash
# Display help
bunx oh-my-opencode

# Or with npx
npx oh-my-opencode
```

## 명령어

| Command                       | 설명                                                  |
| ----------------------------- | ------------------------------------------------------ |
| `install`                     | 인터랙티브 설정 마법사                                  |
| `doctor`                      | 환경 진단 및 헬스 체크                                  |
| `run`                         | 작업 완료 강제와 함께 OpenCode 세션을 실행               |
| `get-local-version`           | 로컬 버전 정보 표시 및 업데이트 확인                    |
| `refresh-model-capabilities`  | models.dev 기반 모델 기능 캐시를 새로고침               |
| `version`                     | 버전 정보 표시                                          |
| `mcp oauth`                   | MCP OAuth 인증 관리                                     |

---

## install

초기 Oh My OpenCode 설정을 위한 인터랙티브 설치 도구. `@clack/prompts` 기반의 TUI를 제공합니다.

### 사용법

```bash
bunx oh-my-opencode install
```

### 설치 과정

1. **구독 선택**: 실제로 가지고 있는 프로바이더와 구독을 선택
2. **플러그인 등록**: OpenCode 설정에 `oh-my-openagent`를 등록하거나, 호환성 기간 동안 레거시 `oh-my-opencode` 항목을 업그레이드
3. **설정 파일 생성**: 활성 OpenCode 설정 디렉터리의 `oh-my-opencode.json`에 생성된 OmO 설정을 작성
4. **인증 힌트**: `--skip-auth`가 설정되지 않은 한, 선택한 프로바이더의 `opencode auth login` 단계를 표시
5. **텔레메트리 기본값**: 환경 변수로 옵트아웃하지 않는 한 익명 텔레메트리는 활성화 상태 유지

### 옵션

| 옵션 | 설명 |
| ------ | ----------- |
| `--no-tui` | TUI 없이 비대화형 모드로 실행 |
| `--claude <no\|yes\|max20>` | Claude 구독 모드 |
| `--openai <no\|yes>` | OpenAI / ChatGPT 구독 |
| `--gemini <no\|yes>` | Gemini 통합 |
| `--copilot <no\|yes>` | GitHub Copilot 구독 |
| `--opencode-zen <no\|yes>` | OpenCode Zen 액세스 |
| `--zai-coding-plan <no\|yes>` | Z.ai Coding Plan 구독 |
| `--kimi-for-coding <no\|yes>` | Kimi for Coding 구독 |
| `--opencode-go <no\|yes>` | OpenCode Go 구독 |
| `--vercel-ai-gateway <no\|yes>` | Vercel AI Gateway: no, yes (default: no) |
| `--skip-auth` | 인증 설정 힌트 건너뛰기 |

익명 텔레메트리는 해시된 설치 식별자를 사용하는 PostHog를 씁니다. `OMO_SEND_ANONYMOUS_TELEMETRY=0` 또는 `OMO_DISABLE_POSTHOG=1`로 비활성화할 수 있습니다. [개인정보 처리방침](../legal/privacy-policy.md)을 참고하세요.

---

## doctor

Oh My OpenCode가 올바르게 작동하도록 환경을 진단합니다. 현재 점검들은 system, config, tools, models로 그룹화되어 있습니다.

doctor 명령은 다음을 포함한 흔한 이슈를 감지합니다:
- `opencode.json`의 레거시 플러그인 항목 참조 (`oh-my-openagent` 대신 `oh-my-opencode`가 여전히 사용될 때 경고)
- 설정 파일 유효성 및 JSONC 파싱 오류
- 모델 해석 및 폴백 체인 검증
- 누락되었거나 잘못 설정된 MCP 서버

### 사용법

```bash
bunx oh-my-opencode doctor
```

### 진단 카테고리

| 카테고리          | 점검 항목                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| **System**        | OpenCode 바이너리, 버전(>= 1.0.150), 플러그인 등록, 레거시 패키지 이름 경고          |
| **Config**        | 설정 파일 유효성, JSONC 파싱, Zod 스키마 검증                                         |
| **Tools**         | AST-Grep, LSP 서버, GitHub CLI, MCP 서버                                              |
| **Models**        | 모델 기능 캐시, 모델 해석, 에이전트/카테고리 오버라이드, 가용성                        |

### 옵션

| 옵션          | 설명                                       |
| ------------ | ----------------------------------------- |
| `--status`   | 컴팩트한 시스템 대시보드 표시              |
| `--verbose`  | 상세 진단 정보 표시                        |
| `--json`     | 결과를 JSON 형식으로 출력                  |

### 출력 예시

```
oh-my-opencode doctor

┌──────────────────────────────────────────────────┐
│  Oh-My-OpenAgent Doctor                           │
└──────────────────────────────────────────────────┘

System
  ✓ OpenCode version: 1.0.155 (>= 1.0.150)
  ✓ Plugin registered in opencode.json

Config
  ✓ oh-my-opencode.jsonc is valid
  ✓ Model resolution: all agents have valid fallback chains
  ⚠ categories.visual-engineering: using default model

Tools
  ✓ AST-Grep available
  ✓ LSP servers configured

Models
  ✓ 11 agents, 8 categories, 0 overrides
  ⚠ Some configured models rely on compatibility fallback

Summary: 10 passed, 1 warning, 0 failed
```
---

## run

todo/백그라운드 작업 완료 강제와 함께 opencode를 실행합니다. 'opencode run'과 달리, 이 명령은 모든 todo가 완료되거나 취소되고 모든 자식 세션(백그라운드 작업)이 idle 상태가 될 때까지 기다립니다.

### 사용법

```bash
bunx oh-my-opencode run <message>
```

### 옵션

| 옵션                  | 설명                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `-a, --agent <name>`  | 사용할 에이전트 (default: CLI/env/config, fallback: Sisyphus)       |
| `-m, --model <provider/model>` | 모델 오버라이드 (예: anthropic/claude-sonnet-4)              |
| `-d, --directory <path>` | 작업 디렉터리                                                    |
| `-p, --port <port>`  | 서버 포트 (이미 사용 중이면 attach)                                  |
| `--attach <url>`      | 기존 opencode 서버 URL에 attach                                      |
| `--on-complete <command>` | 완료 후 실행할 셸 명령                                            |
| `--json`              | 구조화된 JSON 결과를 stdout에 출력                                   |
| `--no-timestamp`      | 실행 출력에서 타임스탬프 접두사 비활성화                              |
| `--verbose`           | 전체 이벤트 스트림 표시 (default: 메시지/도구만)                     |
| `--session-id <id>`   | 새로 생성하지 않고 기존 세션을 재개                                  |

---

## get-local-version

현재 설치된 버전을 표시하고 업데이트를 확인합니다.

### 사용법

```bash
bunx oh-my-opencode get-local-version
```

### 옵션

| 옵션              | 설명                                            |
| ----------------- | ---------------------------------------------- |
| `-d, --directory` | 설정을 확인할 작업 디렉터리                     |
| `--json`          | 스크립팅을 위한 JSON 형식 출력                  |

### 출력

다음을 표시합니다:
- 현재 설치된 버전
- npm에서 사용 가능한 최신 버전
- 최신 상태 여부
- 특수 모드(로컬 dev, 핀된 버전)

---

## version

버전 정보를 표시합니다.

### 사용법

```bash
bunx oh-my-opencode version
```

`--on-complete`는 가능할 때 현재 셸을 통해 실행됩니다: Unix 셸에서는 `sh`, Windows가 아닌 환경의 PowerShell에서는 `pwsh`, Windows의 PowerShell에서는 `powershell.exe`, Windows 폴백으로는 `cmd.exe`.

---

## mcp oauth

원격 MCP 서버를 위한 OAuth 2.1 인증을 관리합니다.

### 사용법

```bash
# Login to an OAuth-protected MCP server
bunx oh-my-opencode mcp oauth login <server-name> --server-url https://api.example.com

# Login with explicit client ID and scopes
bunx oh-my-opencode mcp oauth login my-api --server-url https://api.example.com --client-id my-client --scopes read write

# Remove stored OAuth tokens
bunx oh-my-opencode mcp oauth logout <server-name> --server-url https://api.example.com

# Check OAuth token status
bunx oh-my-opencode mcp oauth status [server-name]
```

### 옵션

| 옵션                 | 설명                                                                       |
| -------------------- | ------------------------------------------------------------------------- |
| `--server-url <url>` | MCP 서버 URL (login에 필수)                                                |
| `--client-id <id>`   | OAuth 클라이언트 ID (서버가 동적 클라이언트 등록을 지원하면 선택)           |
| `--scopes <scopes>`  | 별도의 가변 인자로 전달되는 OAuth 스코프 (예: `--scopes read write`)        |

### 토큰 저장소

토큰은 `0600` 권한(소유자 읽기/쓰기 전용)으로 `~/.config/opencode/mcp-oauth.json`에 저장됩니다. 키 형식: `{serverHost}/{resource}`.

---

## 설정 파일

런타임은 사용자 설정을 베이스 설정으로 로드한 뒤, 그 위에 프로젝트 설정을 병합합니다:

1. **프로젝트 레벨**: `.opencode/oh-my-openagent.jsonc`, `.opencode/oh-my-openagent.json`, `.opencode/oh-my-opencode.jsonc`, 또는 `.opencode/oh-my-opencode.json`
2. **사용자 레벨**: `~/.config/opencode/oh-my-openagent.jsonc`, `~/.config/opencode/oh-my-openagent.json`, `~/.config/opencode/oh-my-opencode.jsonc`, 또는 `~/.config/opencode/oh-my-opencode.json`

**네이밍 노트**: 배포된 패키지와 바이너리는 여전히 `oh-my-opencode`입니다. `opencode.json` 안에서 호환성 레이어는 이제 플러그인 항목 `oh-my-openagent`를 우선합니다. 플러그인 설정 로딩은 `oh-my-openagent.*`와 레거시 `oh-my-opencode.*` 양쪽 베이스네임을 인식합니다. 같은 디렉터리에 두 베이스네임이 모두 존재하면 현재는 레거시 `oh-my-opencode.*` 파일이 이깁니다.

### 파일명 호환성

`.jsonc`와 `.json` 확장자를 모두 지원합니다. JSONC(주석이 있는 JSON)가 다음을 허용하므로 권장됩니다:
- 주석(`//`와 `/* */` 두 스타일 모두)
- 배열과 객체의 후행 콤마

같은 디렉터리에 `.jsonc`와 `.json`이 모두 존재하면 `.jsonc` 파일이 우선합니다.

### JSONC 지원

설정 파일은 **JSONC(주석이 있는 JSON)** 형식을 지원합니다. 주석과 후행 콤마를 사용할 수 있습니다.

```jsonc
{
  // Agent configuration
  "sisyphus_agent": {
    "disabled": false,
    "planner_enabled": true,
  },

  /* Category customization */
  "categories": {
    "visual-engineering": {
      "model": "google/gemini-3.1-pro",
    },
  },
}
```

---

## 트러블슈팅

### "OpenCode version too old" 오류

```bash
# Update OpenCode
npm install -g opencode@latest
# or
bun install -g opencode@latest
```

### "Plugin not registered" 오류

```bash
# Reinstall plugin
bunx oh-my-opencode install
```

### Doctor 점검 실패

```bash
# Diagnose with detailed information
bunx oh-my-opencode doctor --verbose

# Show compact system dashboard
bunx oh-my-opencode doctor --status

# JSON output for scripting
bunx oh-my-opencode doctor --json
```

### "Using legacy package name" 경고

doctor는 `opencode.json`에서 레거시 플러그인 항목 `oh-my-opencode`를 발견하면 경고합니다. 플러그인 배열을 정규(canonical) `oh-my-openagent` 항목으로 갱신하세요:

```bash
# Replace the legacy plugin entry in user config
jq '.plugin = (.plugin // [] | map(if . == "oh-my-opencode" then "oh-my-openagent" else . end))' \
  ~/.config/opencode/opencode.json > /tmp/opencode.json && mv /tmp/opencode.json ~/.config/opencode/opencode.json
```
---

## refresh-model-capabilities

models.dev에서 가져오는 모델 기능 스냅샷을 새로고침합니다. 기능 해석과 호환성 진단에 사용되는 로컬 캐시를 갱신합니다.

### 사용법

```bash
bunx oh-my-opencode refresh-model-capabilities
```

### 옵션

| 옵션              | 설명                                                |
| ----------------- | --------------------------------------------------- |
| `-d, --directory` | oh-my-opencode 설정을 읽어올 작업 디렉터리           |
| `--source-url <url>` | models.dev 소스 URL을 오버라이드                  |
| `--json`          | 새로고침 요약을 JSON으로 출력                       |

### 설정

플러그인 설정에서 자동 새로고침 동작을 설정합니다:

```jsonc
{
  "model_capabilities": {
    "enabled": true,
    "auto_refresh_on_start": true,
    "refresh_timeout_ms": 5000,
    "source_url": "https://models.dev/api.json"
  }
}
```

---

## 비대화 모드

CI 또는 스크립트 진단을 위해 JSON 출력을 사용하세요.

```bash
# Run doctor in CI environment
bunx oh-my-opencode doctor --json

# Save results to file
bunx oh-my-opencode doctor --json > doctor-report.json
```

---

## 개발자 정보

### CLI 구조

```
src/cli/
├── cli-program.ts        # Commander.js-based main entry
├── install.ts            # @clack/prompts-based TUI installer
├── config-manager/       # JSONC parsing, multi-source config management
│   └── *.ts
├── doctor/               # Health check system
│   ├── index.ts          # Doctor command entry
│   └── checks/           # 17+ individual check modules
├── run/                  # Session runner
│   └── *.ts
└── mcp-oauth/            # OAuth management commands
    └── *.ts
```

### 새 Doctor 점검 추가

`src/cli/doctor/checks/my-check.ts`를 생성합니다:

```typescript
import type { DoctorCheck } from "../types";

export const myCheck: DoctorCheck = {
  name: "my-check",
  category: "environment",
  check: async () => {
    // Check logic
    const isOk = await someValidation();

    return {
      status: isOk ? "pass" : "fail",
      message: isOk ? "Everything looks good" : "Something is wrong",
    };
  },
};
```

`src/cli/doctor/checks/index.ts`에 등록:

```typescript
export { myCheck } from "./my-check";
```
