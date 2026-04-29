# src/hooks/ralph-loop/ — 자기 참조형 개발 루프

**생성일:** 2026-04-11

## 개요

14개 파일 (~1687 LOC). `ralphLoop` Session 계층 훅 — `/ralph-loop` 명령을 구동. 에이전트가 `<promise>DONE</promise>`를 내보내거나 최대 반복에 도달할 때까지 개발 루프를 반복.

## 루프 라이프사이클

```
/ralph-loop → startLoop(sessionID, prompt, options)
  → loopState.startLoop() → 상태를 .sisyphus/ralph-loop.local.md에 영속화
  → session.idle 이벤트 → createRalphLoopEventHandler()
    → completionPromiseDetector: 출력에서 <promise>DONE</promise> 스캔
    → 완료되지 않으면: continuation 프롬프트 주입 → 루프
    → 완료되거나 maxIterations 도달: cancelLoop()
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `ralph-loop-hook.ts` | `createRalphLoopHook()` — 컨트롤러 + 복구 + 이벤트 핸들러 구성 |
| `ralph-loop-event-handler.ts` | `createRalphLoopEventHandler()` — session.idle 처리, 루프 구동 |
| `loop-state-controller.ts` | 상태 CRUD: startLoop, cancelLoop, getState, 디스크에 영속화 |
| `loop-session-recovery.ts` | 크래시/중단된 루프 세션에서 복구 |
| `completion-promise-detector.ts` | 세션 트랜스크립트에서 `<promise>DONE</promise>` 스캔 |
| `continuation-prompt-builder.ts` | 다음 반복을 위한 continuation 메시지 빌드 |
| `continuation-prompt-injector.ts` | 빌드된 프롬프트를 활성 세션에 주입 |
| `storage.ts` | `.sisyphus/ralph-loop.local.md` 상태 파일 read/write |
| `message-storage-directory.ts` | 프롬프트 주입용 임시 디렉토리 |
| `with-timeout.ts` | 타임아웃이 있는 API 호출 래퍼 (기본 5000ms) |
| `types.ts` | `RalphLoopState`, `RalphLoopOptions`, 루프 반복 타입 |

## 상태 파일

```
.sisyphus/ralph-loop.local.md  (gitignored)
  → sessionID, prompt, 반복 횟수, maxIterations, completionPromise, ultrawork 플래그
```

## 옵션

```typescript
startLoop(sessionID, prompt, {
  maxIterations?: number  // config 기본값 (default: 100)
  completionPromise?: string  // 사용자 정의 "done" 신호 (default: "<promise>DONE</promise>")
  ultrawork?: boolean  // 반복에 ultrawork 모드 활성화
})
```

## Export 인터페이스

```typescript
interface RalphLoopHook {
  event: (input) => Promise<void>  // session.idle 핸들러
  startLoop: (sessionID, prompt, options?) => boolean
  cancelLoop: (sessionID) => boolean
  getState: () => RalphLoopState | null
}
```
