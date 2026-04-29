# src/hooks/todo-continuation-enforcer/ — Boulder Continuation 메커니즘

**생성일:** 2026-04-11

## 개요

14개 파일 (~2061 LOC). "Boulder" — 미완료 todo가 남아 있을 때 Sisyphus가 계속 굴리도록 강제하는 Continuation 계층 훅. `session.idle`에 발화하여 2초 카운트다운 토스트 후 continuation 프롬프트 주입.

## 작동 방식

```
session.idle
  → 메인 세션인가 (prometheus/compaction 아님)? (DEFAULT_SKIP_AGENTS)
  → 최근에 abort가 감지되지 않았는가? (ABORT_WINDOW_MS = 3s)
  → todo가 여전히 미완료인가? (todo.ts)
  → 실행 중인 백그라운드 태스크가 없는가?
  → 쿨다운이 지났는가? (CONTINUATION_COOLDOWN_MS = 30s)
  → 실패 횟수 < max? (MAX_CONSECUTIVE_FAILURES = 5)
  → 2s 카운트다운 토스트 시작 → CONTINUATION_PROMPT 주입
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `handler.ts` | `createTodoContinuationHandler()` — 이벤트 라우터, idle/non-idle 핸들러에 위임 |
| `idle-event.ts` | `handleSessionIdle()` — session.idle의 메인 결정 게이트 |
| `non-idle-events.ts` | `handleNonIdleEvent()` — session.error 처리 (abort 감지) |
| `session-state.ts` | `SessionStateStore` — 세션별 실패/abort/쿨다운 상태 |
| `todo.ts` | 세션 저장소를 통한 todo 완료 상태 확인 |
| `countdown.ts` | 주입 전 2초 카운트다운 토스트 |
| `abort-detection.ts` | MessageAbortedError / AbortError 감지 |
| `continuation-injection.ts` | CONTINUATION_PROMPT를 빌드 + 세션에 주입 |
| `message-directory.ts` | 메시지 주입 교환을 위한 임시 디렉토리 |
| `constants.ts` | 타이밍 상수, CONTINUATION_PROMPT, 스킵 에이전트 |
| `types.ts` | `SessionState`, 핸들러 인자 타입 |

## 상수

```typescript
DEFAULT_SKIP_AGENTS = ["prometheus", "compaction", "plan"]
CONTINUATION_COOLDOWN_MS = 30_000     // 주입 사이 30s
MAX_CONSECUTIVE_FAILURES = 5          // 그 다음 5분 일시정지 (지수 백오프)
FAILURE_RESET_WINDOW_MS = 5 * 60_000  // 실패 리셋 5분 윈도우
COUNTDOWN_SECONDS = 2
ABORT_WINDOW_MS = 3000                // abort 신호 후 유예 시간
```

## 세션별 상태

```typescript
interface SessionState {
  failureCount: number       // 연속 실패 횟수
  lastFailureAt?: number     // 타임스탬프
  abortDetectedAt?: number   // ABORT_WINDOW_MS 후 리셋
  cooldownUntil?: number     // 다음 주입이 허용되는 시점
  countdownTimer?: Timer     // 활성 카운트다운 참조
}
```

## ATLAS와의 관계

`todoContinuationEnforcer`는 **메인 Sisyphus 세션**만 처리.
`atlasHook`은 다른 결정 게이트로 **boulder/ralph/서브에이전트 세션**을 처리.
둘 다 `session.idle`에 발화하지만 먼저 세션 타입을 확인.
