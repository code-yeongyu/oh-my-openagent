# src/cli/run/ — 비대화형 세션 런처

**생성일:** 2026-04-11

## 개요

37개 파일. `oh-my-opencode run <message>` 명령을 구동. OpenCode 서버에 연결하여 세션 생성/재개, 이벤트 스트리밍, 완료 폴링을 수행.

## 실행 흐름

```
runner.ts
  1. opencode-binary-resolver.ts → OpenCode 바이너리 찾기
  2. server-connection.ts → OpenCode 서버 연결 (필요 시 시작)
  3. agent-resolver.ts → Flag → env → config → Sisyphus
  4. session-resolver.ts → 새 세션 생성 또는 기존 세션 재개
  5. events.ts → 세션의 SSE 이벤트 스트림
  6. event-handlers.ts → 각 이벤트 타입 처리
  7. poll-for-completion.ts → todo + 백그라운드 작업 완료 대기
  8. on-complete-hook.ts → 사용자 정의 완료 훅 실행
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `runner.ts` | 메인 오케스트레이션 — 연결, 해석, 실행, 완료 |
| `server-connection.ts` | OpenCode 서버 프로세스 시작, SDK 클라이언트 생성 |
| `agent-resolver.ts` | 에이전트 해석: `--agent` flag → `OPENCODE_AGENT` env → config → Sisyphus |
| `session-resolver.ts` | 새 세션 생성 또는 `--attach` / `--session-id`로 재개 |
| `events.ts` | SSE 이벤트 스트림 구독 |
| `event-handlers.ts` | 이벤트를 핸들러로 라우팅 (message, tool, error, idle) |
| `event-stream-processor.ts` | 필터링과 버퍼링이 포함된 이벤트 스트림 처리 |
| `poll-for-completion.ts` | todo 완료 + 백그라운드 작업 없을 때까지 세션 폴링 |
| `completion.ts` | 세션이 진정 완료되었는지 판단 |
| `continuation-state.ts` | 호출 간 `run` 연속을 위한 상태 영속화 |
| `output-renderer.ts` | 터미널용 세션 출력 포매팅 |
| `json-output.ts` | JSON 출력 모드 (`--json` flag) |
| `types.ts` | `RunOptions`, `RunResult`, `RunContext`, 이벤트 페이로드 타입 |

## 에이전트 해석 우선순위

```
1. --agent CLI flag
2. OPENCODE_AGENT 환경 변수
3. default_run_agent config
4. "sisyphus" (기본값)
```

## 완료 감지

폴링 기반, 두 가지 조건:
1. 모든 todo가 completed (pending/in_progress 없음)
2. 실행 중인 백그라운드 작업 없음

`on-complete-hook.ts`는 완료 시 선택적 사용자 명령 실행 (예: `--on-complete "notify-send done"`).
