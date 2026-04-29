# src/cli/ — CLI: install, run, doctor, mcp-oauth

**생성일:** 2026-04-18

## 개요

6개 명령을 갖는 Commander.js CLI. 진입점: `index.ts` → `cli-program.ts`의 `runCli()`.

## 명령

| 명령 | 목적 | 핵심 로직 |
|---------|---------|-----------|
| `install` | 대화형/비대화형 설정 | 프로바이더 선택 → 설정 생성 → 플러그인 등록 |
| `run <message>` | 비대화형 세션 런처 | 에이전트 해석 (flag → env → config → Sisyphus) |
| `doctor` | 4개 카테고리 헬스 체크 | System, Config, Tools, Models |
| `get-local-version` | 버전 감지 | 설치된 버전 vs npm latest |
| `mcp-oauth` | OAuth 토큰 관리 | login (PKCE), logout, status |
| `refresh-model-capabilities` | models.dev 캐시 갱신 | 모델 capability 새로고침 |

## 구조

```
cli/
├── index.ts                     # 진입점 → runCli()
├── cli-program.ts               # Commander.js 프로그램 (5개 명령)
├── install.ts                   # TUI 또는 CLI 인스톨러로 라우팅
├── cli-installer.ts             # 비대화형 (콘솔 출력)
├── tui-installer.ts             # 대화형 (@clack/prompts)
├── model-fallback.ts            # 프로바이더 가용성에 따른 모델 설정 생성
├── provider-availability.ts     # 프로바이더 감지
├── fallback-chain-resolution.ts # Fallback chain 로직
├── config-manager/              # 20개 설정 유틸리티
│   ├── 플러그인 등록, 프로바이더 설정
│   ├── JSONC 작업, auth 플러그인
│   └── npm dist-tags, 바이너리 감지
├── doctor/
│   ├── runner.ts                # 병렬 체크 실행
│   ├── formatter.ts             # 출력 포매팅
│   └── checks/                  # 4개 카테고리의 15개 체크 파일
│       ├── system.ts            # 바이너리, 플러그인, 버전
│       ├── config.ts            # JSONC 유효성, Zod 스키마
│       ├── tools.ts             # AST-Grep, LSP, GH CLI, MCP
│       └── model-resolution.ts  # 캐시, 해석, 오버라이드 (6개 하위 파일)
├── run/                         # 세션 런처
│   ├── runner.ts                # 메인 오케스트레이션
│   ├── agent-resolver.ts        # Flag → env → config → Sisyphus
│   ├── session-resolver.ts      # 세션 생성/재개
│   ├── event-handlers.ts        # 이벤트 처리
│   └── poll-for-completion.ts   # todo/백그라운드 작업 대기
└── mcp-oauth/                   # OAuth 토큰 관리
```

## 모델 Fallback 시스템

단일 글로벌 우선순위는 없음. CLI install 시점 해석은 `model-fallback-requirements.ts`의 에이전트별 fallback chain을 사용.

일반적인 패턴: Claude/OpenAI/Gemini는 에이전트 chain에 포함되었을 때 선호되며, `librarian`은 ZAI를 선호하고, `sisyphus`는 Kimi 다음 GLM-5로 fallback하며, `hephaestus`는 OpenAI 호환 프로바이더가 필요함.

## Doctor 체크

| 카테고리 | 검증 대상 |
|----------|-----------|
| **System** | 바이너리 존재, 버전 >=1.0.150, 플러그인 등록, 버전 일치 |
| **Config** | JSONC 유효성, Zod 스키마, 모델 오버라이드 문법 |
| **Tools** | AST-Grep, comment-checker, LSP 서버, GH CLI, MCP 서버 |
| **Models** | 캐시 존재, 모델 해석, 에이전트/카테고리 오버라이드, 가용성 |

## Doctor 체크 추가 방법

1. `src/cli/doctor/checks/{name}.ts` 생성
2. `DoctorCheck` 인터페이스에 부합하는 체크 함수 export
3. `checks/index.ts`에 등록
