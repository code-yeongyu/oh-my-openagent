# oh-my-opencode — OpenCode 플러그인

**생성일:** 2026-04-18 | **커밋:** 2892ca4a | **브랜치:** dev

## 개요

OpenCode 플러그인(npm: `oh-my-opencode`, 전환 기간 동안 `oh-my-openagent`로 이중 배포). 11개 에이전트, 52개 라이프사이클 훅(hook), 26개 도구, 3계층 MCP 시스템(빌트인 + .mcp.json + 스킬 임베디드), Hashline LINE#ID 편집 도구, IntentGate 분류기, Claude Code 호환성을 통해 Claude Code를 확장한다. TypeScript 소스 파일 1766개, 377k LOC, 104개 배럴 index.ts 파일. 진입점: `src/index.ts` → 5단계 초기화(loadConfig → createManagers → createTools → createHooks → createPluginInterface).

## 구조

```
oh-my-opencode/
├── src/
│   ├── index.ts              # 플러그인 진입점: 기본 export `pluginModule`, 형태 `{ id, server }`
│   ├── plugin-config.ts      # JSONC 다중 레벨 설정: 사용자 → 프로젝트 → 기본값 (Zod v4)
│   ├── agents/               # 11개 에이전트 (Sisyphus, Hephaestus, Oracle, Librarian, Explore, Atlas, Prometheus, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
│   ├── hooks/                # 전용 모듈과 단독 파일에 걸쳐 52개 라이프사이클 훅
│   ├── tools/                # 16개 디렉터리에 걸친 26개 도구 (LINE#ID 콘텐츠 해싱을 사용하는 Hashline 편집 포함)
│   ├── features/             # 19개 피처 모듈 (background-agent, skill-loader, tmux, MCP-OAuth, skill-mcp-manager 등)
│   ├── shared/               # 170개 이상의 유틸리티 파일 (배럴 export, logger → /tmp/oh-my-opencode.log)
│   ├── config/               # Zod v4 스키마 시스템 (32개 파일)
│   ├── cli/                  # CLI: install, run, doctor, mcp-oauth (Commander.js)
│   ├── mcp/                  # 3개 빌트인 원격 MCP (websearch, context7, grep_app)
│   ├── plugin/               # 10개 OpenCode 훅 핸들러 + 52개 훅 컴포지션
│   ├── plugin-handlers/      # 6단계 설정 로딩 파이프라인
│   └── openclaw/             # 양방향 외부 통합 (Discord/Telegram/webhook/command)
├── packages/                 # 11개 플랫폼별 컴파일된 바이너리 (darwin/linux/windows, AVX2 + baseline 변형)
├── script/                   # 빌드/배포 자동화 (단수형, scripts/ 아님)
├── .sisyphus/                # AI 에이전트 작업공간 (rules, plans, tasks, notepads)
└── .local-ignore/            # 개발 전용 테스트 픽스처 + PR 워크트리
```

## 초기화 흐름

```
pluginModule.server(input, options)
  ├─→ loadPluginConfig()         # JSONC 파싱 → 프로젝트/사용자 병합 → Zod 검증 → 마이그레이션
  ├─→ createManagers()           # TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler
  ├─→ createTools()              # SkillContext + AvailableCategories + ToolRegistry (26개 도구)
  ├─→ createHooks()              # 3계층: Core(43) + Continuation(7) + Skill(2) = 52개 훅
  └─→ createPluginInterface()    # 10개 OpenCode 훅 핸들러 → PluginInterface
```

## 10개 OPENCODE 훅 핸들러

| 핸들러 | 목적 |
|---------|---------|
| `config` | 6단계: provider → plugin-components → agents → tools → MCPs → commands |
| `tool` | 등록된 26개 도구 |
| `chat.message` | 첫 메시지 변형, 세션 셋업, 키워드 감지 (ultrawork/search/analyze) |
| `chat.params` | Anthropic effort 레벨, think 모드, 런타임 폴백 오버라이드 |
| `chat.headers` | Copilot x-initiator 헤더 주입 |
| `event` | 세션 라이프사이클 (created, deleted, idle, error), openclaw 디스패치, 런타임 폴백 |
| `tool.execute.before` | 도구 실행 전 훅 (file guard, label truncator, rules injector, prometheus md-only) |
| `tool.execute.after` | 도구 실행 후 훅 (출력 잘림 처리, comment checker, hashline read enhancer) |
| `experimental.chat.messages.transform` | 컨텍스트 주입, thinking 블록 검증, 도구 페어 검증 |
| `experimental.session.compacting` | 컴팩션 중 컨텍스트 + todo 보존 |

## 어디를 봐야 하는가

| 작업 | 위치 | 비고 |
|------|----------|-------|
| 새 에이전트 추가 | `src/agents/` + `src/agents/builtin-agents/` | createXXXAgent 팩토리 패턴 따르기 |
| 새 훅 추가 | `src/hooks/{name}/` + `src/plugin/hooks/create-*-hooks.ts`에 등록 | 이벤트 타입을 계층에 맞춤 |
| 새 도구 추가 | `src/tools/{name}/` + `src/plugin/tool-registry.ts`에 등록 | createXXXTool 팩토리 따르기 |
| 새 피처 모듈 추가 | `src/features/{name}/` | 단독 모듈, plugin/에서 연결 |
| 새 MCP 추가 | `src/mcp/` + `createBuiltinMcps()`에 등록 | 원격 HTTP만 (3계층 중 1계층) |
| 새 스킬 추가 | `src/features/builtin-skills/skills/` | BuiltinSkill 인터페이스 구현 |
| 새 명령 추가 | `src/features/builtin-commands/` | templates/에 템플릿 |
| 새 CLI 명령 추가 | `src/cli/cli-program.ts` | Commander.js 서브커맨드 |
| 새 doctor 체크 추가 | `src/cli/doctor/checks/` | checks/index.ts에 등록 |
| 설정 스키마 수정 | `src/config/schema/` + 루트 스키마 업데이트 | Zod v4, OhMyOpenCodeConfigSchema에 추가 |
| 새 카테고리 추가 | `src/tools/delegate-task/constants.ts` | DEFAULT_CATEGORIES + CATEGORY_MODEL_REQUIREMENTS |
| provider 오류 디버그 | `src/hooks/runtime-fallback/` | 반응형 오류 복구 (model-fallback과 구분됨) |
| 외부 알림 | `src/openclaw/` | 양방향 Discord/Telegram/webhook 통합 |
| 스킬 임베디드 MCP | `src/features/skill-mcp-manager/` | 3계층 MCP (stdio + HTTP, 세션별) |

## 다중 레벨 설정

```
프로젝트 (.opencode/oh-my-opencode.jsonc)  →  사용자 (~/.config/opencode/oh-my-opencode.jsonc)  →  기본값
```

- `agents`, `categories`, `claude_code`: 재귀적으로 깊은 병합 (prototype-pollution 방지)
- `disabled_*` 배열: 집합 합집합 (연결 + 중복 제거)
- 그 외 모든 필드: 오버라이드가 베이스 값을 대체
- Zod `safeParse()`가 누락된 필드의 기본값을 채움; 부분 파싱은 폴백
- `migrateConfigFile()`은 레거시 키를 자동 변환 (`_migrations` 추적을 통해 멱등)

필드: agents (14개 오버라이드 가능, 각 21개 필드), categories (빌트인 8개 + 커스텀), disabled_* 배열 (agents, hooks, mcps, skills, commands, tools), 19개 피처별 설정.

## 3계층 MCP 시스템

| 계층 | 출처 | 메커니즘 |
|------|--------|-----------|
| 빌트인 | `src/mcp/` | 3개 원격 HTTP: websearch (Exa/Tavily), context7, grep_app |
| Claude Code | `.mcp.json` | claude-code-mcp-loader를 통해 `${VAR}` 환경 변수 확장 |
| 스킬 임베디드 | SKILL.md YAML | SkillMcpManager가 관리 (stdio + HTTP) |

## 컨벤션

- **런타임**: Bun 전용 (CI에서 1.3.11) -- npm/yarn 절대 사용 금지
- **TypeScript**: strict 모드, ESNext, bundler moduleResolution, `bun-types` (`@types/node` 절대 금지)
- **테스트 패턴**: Bun 테스트 (`bun:test`), 동일 위치의 `*.test.ts`, given/when/then 스타일 (중첩 describe에 `#given`/`#when`/`#then` 접두사 또는 인라인 `// given` / `// when` / `// then` 주석)
- **CI 테스트 분할**: `script/run-ci-tests.ts`가 `mock.module()` 사용을 자동 감지하고 해당 테스트들을 별도 프로세스로 분리
- **팩토리 패턴**: 모든 도구, 훅, 에이전트에 `createXXX()`
- **훅 계층**: Session (24) → Tool-Guard (14) → Transform (5) → Continuation (7) → Skill (2)
- **에이전트 모드**: `primary` (UI 모델 존중) vs `subagent` (자체 폴백 체인) vs `all`
- **모델 해석**: 4단계: 오버라이드 → 카테고리-기본값 → provider-폴백 → 시스템-기본값
- **설정 형식**: 주석 포함 JSONC, Zod v4 검증, snake_case 키
- **파일 명명**: 모든 파일/디렉터리 kebab-case
- **모듈 구조**: index.ts 배럴 export, catch-all 파일 금지 (utils.ts, helpers.ts 금지), 200 LOC 소프트 한도
- **임포트**: 모듈 내부는 상대, 모듈 간은 배럴 임포트 (`import { log } from "./shared"`)
- **경로 별칭 없음**: `@/` 없음 -- 상대 임포트만
- **이중 패키지**: `oh-my-opencode` + `oh-my-openagent` 동시 배포 (전환 기간)

## 안티 패턴

- `as any`, `@ts-ignore`, `@ts-expect-error` 절대 사용 금지
- lint/타입 오류 절대 억제 금지
- 사용자가 명시적으로 요청하지 않는 한 코드/주석에 이모지 절대 추가 금지
- 명시적 요청이 없으면 절대 커밋 금지
- `bun publish` 직접 실행 절대 금지 -- GitHub Actions 사용
- 로컬에서 `package.json` 버전 절대 수정 금지
- 테스트: given/when/then -- Arrange-Act-Assert 주석 절대 사용 금지
- 주석: AI 생성 주석 패턴 회피 (comment-checker 훅에 의해 강제)
- catch-all 파일 절대 생성 금지 (`utils.ts`, `helpers.ts`, `service.ts`)
- 빈 catch 블록 `catch(e) {}` -- 항상 오류 처리
- 생성 콘텐츠에 em dash, en dash, AI 필러 문구 절대 사용 금지
- index.ts는 진입점 전용 -- 비즈니스 로직 절대 덤프 금지

## 명령

```bash
bun test                    # Bun 테스트 스위트
bun run build              # 플러그인 빌드 (ESM + 선언 + 스키마)
bun run build:all          # 빌드 + 플랫폼 바이너리
bun run typecheck           # tsc --noEmit
bunx oh-my-opencode install # 대화형 셋업
bunx oh-my-opencode doctor  # 헬스 진단
bunx oh-my-opencode run     # 비대화형 세션
```

## CI/CD

| 워크플로 | 트리거 | 목적 |
|----------|---------|---------|
| ci.yml | master/dev에 push/PR | 테스트 (분할: mock 위주 격리 + 배치), 타입체크, 빌드, 스키마 자동 커밋 |
| publish.yml | 수동 디스패치 | 버전 범프, npm 이중 배포 (oh-my-opencode + oh-my-openagent), 플랫폼 바이너리, GitHub 릴리스 |
| publish-platform.yml | publish가 호출 | bun compile을 통한 11개 플랫폼 바이너리 (darwin/linux/windows) |
| sisyphus-agent.yml | @멘션 / 디스패치 | AI 에이전트가 이슈/PR 처리 |
| refresh-model-capabilities.yml | 주간 스케줄 / 디스패치 | models.dev API에서 모델 capability 자동 새로고침 |
| cla.yml | issue_comment/PR | 컨트리뷰터용 CLA 도우미 |
| lint-workflows.yml | .github/에 push | 워크플로 파일에 actionlint + shellcheck |

## 노트

- Logger는 `/tmp/oh-my-opencode.log`에 기록 -- 디버깅 시 확인
- 백그라운드 작업: 모델/provider당 동시 5개 (설정 가능, circuit breaker 지원)
- 플러그인 로드 타임아웃: Claude Code 플러그인의 경우 10초
- 모델 폴백: `shared/model-requirements.ts`의 에이전트별 체인, 단일 글로벌 우선순위 아님
- 두 가지 폴백 시스템: `model-fallback` (선제적, chat.params) vs `runtime-fallback` (반응적, session.error)
- 설정 마이그레이션: `_migrations` 추적을 통해 멱등, 원자적 쓰기 전 타임스탬프 백업 생성
- 빌드: bun build (ESM) + tsc --emitDeclarationOnly, externals: @ast-grep/napi
- 테스트 셋업: `test-setup.ts`가 bunfig.toml을 통해 사전 로드, 테스트 간 세션/캐시 상태 리셋
- 테스트 분할: `script/run-ci-tests.ts`가 `mock.module()` 사용 파일 자동 격리 (추가로 `src/openclaw/__tests__/reply-listener-discord.test.ts`)
- 104개의 배럴 export 파일 (index.ts)이 모듈 경계를 확립
- 아키텍처 규칙은 `.sisyphus/rules/modular-code-enforcement.md`로 강제
- Windows 빌드는 Bun segfault를 피하기 위해 `windows-latest` 러너에서 실행 (크로스 컴파일 아님)
- 플랫폼 바이너리는 런타임에 AVX2 + libc 패밀리를 감지, 필요 시 baseline으로 폴백
- Hashline 편집: 모든 Read 출력에 `LINE#ID` 콘텐츠 해시가 태깅됨; 해시 불일치 시 편집 거부
- IntentGate: 라우팅 전에 사용자 의도(research/implementation/investigation/evaluation/fix)를 분류
