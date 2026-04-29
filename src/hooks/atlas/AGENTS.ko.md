# src/hooks/atlas/ — 마스터 Boulder 오케스트레이터

**생성일:** 2026-04-18

## 개요

17개 파일 (~1976 LOC). `atlasHook` — session.idle 이벤트를 모니터링하고 boulder 세션(ralph-loop, 태스크에서 spawn된 에이전트)에 미완료 작업이 있을 때 continuation을 강제하는 Continuation 계층 훅. 또한 서브에이전트 세션을 위한 write/edit 정책을 강제 집행.

## ATLAS의 역할

Atlas는 "세션의 수호자" — 모든 세션을 추적하며 다음을 결정:
1. 이 세션을 강제로 계속하게 해야 하는가? (boulder 세션이고 todo가 미완료라면)
2. write/edit를 차단해야 하는가? (특정 세션 타입에 대한 정책 강제)
3. 검증 알림을 주입해야 하는가? (도구 실행 후)

## 결정 게이트 (session.idle)

```
session.idle event
  → boulder/ralph/atlas 세션인가? (session-last-agent.ts)
  → abort 신호가 있는가? (is-abort-error.ts)
  → 실패 횟수 < max? (state.promptFailureCount)
  → 실행 중인 백그라운드 태스크가 없는가?
  → 에이전트가 예상과 일치하는가? (recent-model-resolver.ts)
  → 계획이 완료되었는가? (todo 상태)
  → 쿨다운이 지났는가? (주입 사이 5s)
  → continuation 프롬프트 주입 (boulder-continuation-injector.ts)
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `atlas-hook.ts` | `createAtlasHook()` — 이벤트 + 도구 핸들러 구성, 세션 상태 유지 |
| `event-handler.ts` | `createAtlasEventHandler()` — session.idle 이벤트의 결정 게이트 |
| `boulder-continuation-injector.ts` | continuation 프롬프트를 빌드 + 세션에 주입 |
| `system-reminder-templates.ts` | continuation 알림 메시지 템플릿 |
| `tool-execute-before.ts` | 세션 정책 기반으로 write/edit 차단 |
| `tool-execute-after.ts` | 도구 실행 후 검증 알림 주입 |
| `write-edit-tool-policy.ts` | 정책: 어떤 세션이 write/edit 가능한가? |
| `verification-reminders.ts` | 작업 검증을 위한 알림 콘텐츠 |
| `session-last-agent.ts` | 세션을 소유하는 에이전트 결정 |
| `recent-model-resolver.ts` | 최근 메시지에서 사용된 모델 해석 |
| `subagent-session-id.ts` | 세션이 서브에이전트 세션인지 감지 |
| `sisyphus-path.ts` | `.sisyphus/` 디렉토리 경로 해석 |
| `is-abort-error.ts` | 세션 출력에서 abort 신호 감지 |
| `types.ts` | `SessionState`, `AtlasHookOptions`, `AtlasContext` |

## 세션별 상태

```typescript
interface SessionState {
  promptFailureCount: number  // continuation 실패 시 증가
  // 성공 시 리셋
}
```

5분 일시정지 전 최대 연속 실패: 5 (todo-continuation-enforcer의 지수 백오프).

## 다른 훅과의 관계

- **atlasHook** (Continuation 계층): 마스터 오케스트레이터, boulder 세션 처리
- **todoContinuationEnforcer** (Continuation 계층): 메인 Sisyphus 세션을 위한 "Boulder" 메커니즘
- 둘 다 session.idle에 주입하지만 서로 다른 세션 타입을 담당
