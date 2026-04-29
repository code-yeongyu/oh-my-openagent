# Oh My OpenCode 기여하기

먼저, 시간을 내어 기여해 주셔서 감사합니다! 이 문서는 oh-my-opencode에 기여하기 위한 가이드라인과 절차를 제공합니다.

## 목차

- [행동 강령](#code-of-conduct)
- [시작하기](#getting-started)
  - [사전 요구 사항](#prerequisites)
  - [개발 환경 설정](#development-setup)
  - [로컬에서 변경 사항 테스트하기](#testing-your-changes-locally)
- [프로젝트 구조](#project-structure)
- [개발 워크플로](#development-workflow)
  - [빌드 명령](#build-commands)
  - [코드 스타일 & 컨벤션](#code-style--conventions)
- [변경 사항 만들기](#making-changes)
  - [새 에이전트 추가](#adding-a-new-agent)
  - [새 훅 추가](#adding-a-new-hook)
  - [새 도구 추가](#adding-a-new-tool)
  - [새 MCP 서버 추가](#adding-a-new-mcp-server)
- [Pull Request 절차](#pull-request-process)
- [배포](#publishing)
- [도움 받기](#getting-help)

## 행동 강령

존중하고, 포용적이며, 건설적으로 행동해 주세요. 우리 모두는 더 나은 도구를 함께 만들기 위해 모인 것입니다.

## 언어 정책

**이 저장소의 모든 커뮤니케이션은 영어를 기본 언어로 합니다.**

여기에는 다음이 포함됩니다:

- 이슈 및 버그 리포트
- Pull Request 및 코드 리뷰
- 문서 및 주석
- 토론 및 커뮤니티 상호작용

### 왜 영어인가요?

- **글로벌 접근성**: 영어를 통해 모든 지역의 컨트리뷰터가 효과적으로 협업할 수 있습니다
- **일관성**: 단일 언어를 사용하면 토론이 정리되고 검색 가능해집니다
- **오픈소스 모범 사례**: 대부분의 성공적인 오픈소스 프로젝트는 영어를 공용어로 사용합니다

### 영어가 어렵다면?

영어가 모국어가 아니라도 걱정하지 마세요! 우리는 완벽한 문법과 관계없이 여러분의 기여를 소중히 여깁니다. 다음을 활용할 수 있습니다:

- 메시지 작성을 돕는 번역 도구 사용
- 다른 커뮤니티 멤버에게 도움 요청
- 완벽한 문장보다 명확하고 간결한 커뮤니케이션에 집중

## 시작하기

### 사전 요구 사항

- **Bun** (최신 버전) - 유일하게 지원되는 패키지 매니저
- **TypeScript** - 타입 검사 및 선언을 위한 strict 모드

### 개발 환경 설정

```bash
# 저장소 클론
git clone https://github.com/code-yeongyu/oh-my-openagent.git
cd oh-my-openagent

# 의존성 설치 (bun 전용 - npm/yarn 절대 사용 금지)
bun install

# 프로젝트 빌드
bun run build
```

### 로컬에서 변경 사항 테스트하기

변경 후 로컬 빌드를 OpenCode에서 테스트할 수 있습니다:

1. **프로젝트 빌드**:

   ```bash
   bun run build
   ```

2. **OpenCode 설정 업데이트** (`~/.config/opencode/opencode.json` 또는 `opencode.jsonc`):

   ```json
   {
     "plugin": ["file:///absolute/path/to/oh-my-opencode/dist/index.js"]
   }
   ```

   예를 들어 프로젝트가 `/Users/yourname/projects/oh-my-opencode`에 있다면:

   ```json
   {
     "plugin": ["file:///Users/yourname/projects/oh-my-opencode/dist/index.js"]
   }
   ```

   > **참고**: npm 버전과의 충돌을 피하려면 plugin 배열에 `"oh-my-opencode"`가 있는 경우 제거하세요.

3. **OpenCode를 재시작**하여 변경 사항을 로드합니다.

4. OmO 에이전트 가용성이나 시작 메시지를 통해 플러그인이 로드되었는지 **확인**합니다.

## 프로젝트 구조

```
oh-my-opencode/
├── src/
│   ├── index.ts         # 플러그인 진입점 (V1 PluginModule, 기본 export)
│   ├── plugin-config.ts # JSONC 다중 레벨 설정 (Zod v4)
│   ├── agents/          # 11개 에이전트 (Sisyphus, Hephaestus, Oracle, Librarian, Explore, Atlas, Prometheus, Metis, Momus, Multimodal-Looker, Sisyphus-Junior)
│   ├── hooks/           # 55개 전용 모듈에 걸친 52개 라이프사이클 훅
│   ├── tools/           # 16개 디렉터리에 걸친 26개 도구
│   ├── mcp/             # 3개 빌트인 원격 MCP (websearch, context7, grep_app)
│   ├── features/        # 19개 피처 모듈 (background-agent, skill-loader, tmux, MCP-OAuth 등)
│   ├── config/          # Zod v4 스키마 시스템
│   ├── shared/          # 횡단 관심사 유틸리티
│   ├── cli/             # CLI: install, run, doctor, mcp-oauth (Commander.js)
│   ├── plugin/          # 10개 OpenCode 훅 핸들러 + 52개 훅 컴포지션
│   └── plugin-handlers/ # 6단계 설정 로딩 파이프라인
├── packages/            # 모노레포: comment-checker, opencode-sdk
└── dist/                # 빌드 출력 (ESM + .d.ts)
```

## 개발 워크플로

### 빌드 명령

```bash
# 타입 검사만
bun run typecheck

# 전체 빌드 (ESM + TypeScript 선언 + JSON 스키마)
bun run build

# 빌드 출력 정리
bun run clean

# 처음부터 재빌드
bun run clean && bun run build

# 스키마만 빌드 (src/config/schema.ts 수정 후)
bun run build:schema
```

### 코드 스타일 & 컨벤션

| 컨벤션       | 규칙                                                                      |
| ---------------- | ------------------------------------------------------------------------- |
| 패키지 매니저  | **Bun 전용** (`bun run`, `bun build`, `bunx`)                             |
| 타입            | `bun-types` 사용, `@types/node` 금지                                        |
| 디렉터리 명명 | kebab-case (`ast-grep/`, `claude-code-hooks/`)                            |
| 파일 작업  | 코드 내 파일 생성에 bash 명령(mkdir/touch/rm) 절대 사용 금지        |
| 도구 구조   | 각 도구: `index.ts`, `types.ts`, `constants.ts`, `tools.ts`, `utils.ts` |
| 훅 패턴     | `createXXXHook(input: PluginInput)` 함수 명명                       |
| Export        | 배럴 패턴 (index.ts에서 `export * from "./module"`)                   |

**안티 패턴 (하지 말 것)**:

- bun 대신 npm/yarn 사용
- `bun-types` 대신 `@types/node` 사용
- `as any`, `@ts-ignore`, `@ts-expect-error`로 TypeScript 오류 억제
- 일반적인 AI 생성 주석 부풀리기
- 직접 `bun publish` 실행 (GitHub Actions만 사용)
- `package.json`에서 로컬 버전 수정

## 변경 사항 만들기

### 새 에이전트 추가

1. `src/agents/`에 새 `.ts` 파일 생성
2. 기존 패턴을 따라 에이전트 설정 정의
3. `src/agents/index.ts`의 `builtinAgents`에 추가
4. 필요 시 `src/agents/types.ts` 업데이트
5. `bun run build:schema`로 JSON 스키마 업데이트

```typescript
// src/agents/my-agent.ts
import type { AgentConfig } from "./types";

export const myAgent: AgentConfig = {
  name: "my-agent",
  model: "anthropic/claude-opus-4-7",
  description: "Description of what this agent does",
  prompt: `Your agent's system prompt here`,
  temperature: 0.1,
  // ... other config
};
```

### 새 훅 추가

1. `src/hooks/`에 새 디렉터리 생성 (kebab-case)
2. 이벤트 핸들러를 반환하는 `createXXXHook()` 함수 구현
3. `src/hooks/index.ts`에서 export

```typescript
// src/hooks/my-hook/index.ts
import type { PluginInput } from "@opencode-ai/plugin";

export function createMyHook(input: PluginInput) {
  return {
    onSessionStart: async () => {
      // Hook logic here
    },
  };
}
```

### 새 도구 추가

1. `src/tools/`에 필수 파일과 함께 새 디렉터리 생성:
   - `index.ts` - 메인 export
   - `types.ts` - TypeScript 인터페이스
   - `constants.ts` - 상수 및 도구 설명
   - `tools.ts` - 도구 구현
   - `utils.ts` - 헬퍼 함수
2. `src/tools/index.ts`의 `builtinTools`에 추가

### 새 MCP 서버 추가

1. `src/mcp/`에 설정 생성
2. `src/mcp/index.ts`에 추가
3. 외부 셋업이 필요한 경우 README에 문서화

## Pull Request 절차

1. 저장소를 **Fork**하고 `dev`에서 브랜치 생성
2. 위 컨벤션을 따라 **변경 사항 작성**
3. 로컬에서 **빌드 및 테스트**:
   ```bash
   bun run typecheck  # 타입 오류 없는지 확인
   bun run build      # 빌드 성공 확인
   ```
4. 위에서 설명한 로컬 빌드 방법으로 **OpenCode에서 테스트**
5. 명확하고 설명적인 메시지로 **커밋**:
   - 현재 시제 사용 ("Added feature"가 아닌 "Add feature")
   - 해당 시 이슈 참조 ("Fix #123")
6. fork에 **push**하고 Pull Request 생성
7. PR 설명에 변경 사항을 명확히 **기술**

### PR 체크리스트

- [ ] 코드가 프로젝트 컨벤션을 따름
- [ ] `bun run typecheck` 통과
- [ ] `bun run build` 성공
- [ ] OpenCode에서 로컬 테스트 완료
- [ ] 필요 시 문서 업데이트 (README, AGENTS.md)
- [ ] `package.json`에 버전 변경 없음

## 배포

**중요**: 배포는 GitHub Actions를 통해서만 처리됩니다.

- `bun publish`를 직접 실행하지 **마세요** (OIDC provenance 문제)
- `package.json` 버전을 로컬에서 수정하지 **마세요**
- 메인테이너는 GitHub Actions workflow_dispatch를 사용합니다:
  ```bash
  gh workflow run publish -f bump=patch  # 또는 minor/major
  ```

## 도움 받기

- **프로젝트 지식**: 상세한 프로젝트 문서는 `AGENTS.md` 참조
- **코드 패턴**: `src/`의 기존 구현 검토
- **이슈**: 버그나 기능 요청 시 이슈 오픈
- **토론**: 질문이나 아이디어가 있으면 토론 시작

---

Oh My OpenCode에 기여해 주셔서 감사합니다! 여러분의 노력이 모두를 위한 AI 보조 코딩을 더 좋게 만듭니다.
