# src/hooks/runtime-fallback/ — 반응형 프로바이더 에러 복구

**생성일:** 2026-04-11

## 개요

32개 파일. API 프로바이더가 런타임에 에러를 반환할 때(429, 503, 쿼터 소진, 쿨다운 신호) **반응적으로** 폴백 모델로 전환하는 Session 계층 훅. `model-fallback`(chat.params에서 사전적으로 적용)과 구별됨.

## RUNTIME-FALLBACK vs MODEL-FALLBACK

| 측면 | runtime-fallback | model-fallback |
|--------|-----------------|----------------|
| **트리거** | 반응형 — 에러 발생 후 | 사전형 — 요청 시점 |
| **이벤트** | session.error, message.updated, session.status | chat.params |
| **설정 출처** | `categories[].fallback_models`, `agents[].fallback_models` | `AGENT_MODEL_REQUIREMENTS` 하드코딩된 체인 |
| **상태** | 세션별 FallbackState + 쿨다운 추적 | 모듈 전역 pendingModelFallbacks |
| **사용 사례** | 실행 중 프로바이더 에러 | 사전 구성된 에이전트 폴백 체인 |

둘은 **독립적으로** 작동 — 직접 통합 없음.

## 에러 감지

### HTTP 상태 코드 (설정 가능)
기본 재시도 코드: `429, 500, 502, 503, 504`

### 에러 메시지 패턴 (constants.ts)
```
/rate.?limit/i, /too.?many.?requests/i, /quota.*reset.*after/i,
/exhausted.*capacity/i, /all.*credentials.*for.*model/i,
/cool(?:ing)?.?down/i, /model.*not.*supported/i,
/service.?unavailable/i, /overloaded/i, /temporarily.?unavailable/i
```

### 에러 타입 분류 (error-classifier.ts)
- `missing_api_key` — 프로바이더가 인증 거부
- `model_not_found` — 모델 사용 불가
- `quota_exceeded` — 빌링/쿼터 한계 도달
- `auto-retry-signal.ts`를 통한 자동 재시도 신호 감지 — "retrying in ~2 weeks" 같은 신호를 추출하여 즉시 폴백 트리거

## 폴백 상태 머신

```typescript
interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>  // 모델 → 쿨다운-종료 타임스탬프
  attemptCount: number
  pendingFallbackModel?: string
}
```

## 폴백 체인 해석 (fallback-models.ts)

우선순위:
1. **세션 카테고리** (SessionCategoryRegistry 통해)
2. **에이전트 config** `fallback_models`
3. **에이전트의 카테고리** `fallback_models`
4. **세션 ID 패턴 매칭** (세션 ID 형식에서 에이전트 감지)

## 재시도 흐름

```
session.error / message.updated (with error) / session.status (재시도 신호)
  → isRetryableError(error)?
  → getFallbackModelsForSession(sessionID, agent)
  → findNextAvailableFallback() — 쿨다운 중인 모델 스킵
  → prepareFallback() — 상태 업데이트, 현재 모델을 실패로 마크
  → dispatchFallbackRetry() — 토스트 알림 + 새 모델로 promptAsync
  → 30s 타임아웃 — 초과 시 abort하고 다음 시도
```

## 쿨다운 메커니즘

실패한 모델은 60s 쿨다운에 진입. `findNextAvailableFallback()`은 쿨다운 중인 모델을 스킵하여 지속적으로 실패하는 모델에 대한 thrashing 방지.

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `hook.ts` | `createRuntimeFallbackHook()` — 모든 핸들러 구성 |
| `event-handler.ts` | 세션 라이프사이클 라우팅 (created, error, stop, idle) |
| `message-update-handler.ts` | `message.updated`의 에러 부분 처리 |
| `session-status-handler.ts` | session.status의 프로바이더 재시도 신호 처리 |
| `chat-message-handler.ts` | chat.message에 폴백 모델 오버라이드 적용 |
| `error-classifier.ts` | `isRetryableError()`, `classifyErrorType()` |
| `auto-retry-signal.ts` | "retrying in..." 신호 추출 |
| `fallback-state.ts` | 상태 머신: createFallbackState, prepareFallback, findNextAvailableFallback, isModelInCooldown |
| `fallback-models.ts` | config 계층에서 체인 해석 (문자열 + raw 객체) |
| `fallback-bootstrap-model.ts` | 상태가 없을 때 초기 모델 도출 |
| `fallback-retry-dispatcher.ts` | 토스트 + 재시도 디스패치 오케스트레이션 |
| `auto-retry.ts` | abort, 타임아웃 스케줄링, 클린업 |
| `agent-resolver.ts` | 세션 → 에이전트 이름 정규화 |
| `retry-model-payload.ts` | 모델 페이로드 빌드 (providerID/modelID/variant/reasoningEffort) |
| `visible-assistant-response.ts` | 어시스턴트가 실제 출력을 생성했는지 vs 에러만 발생했는지 감지 |
| `last-user-retry-parts.ts` | 재시도용 마지막 사용자 메시지 부분 추출 |

## 노트

- 쿨다운과 실패 추적은 **세션별** — 동시 세션은 상태를 공유하지 않음
- `visible-assistant-response.ts`는 어시스턴트가 이미 부분적으로 유효한 응답을 생성한 경우 재시도 방지
- runtime-fallback은 `create-session-hooks.ts`를 통해 Session 계층에 등록됨
