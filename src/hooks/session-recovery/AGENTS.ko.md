# src/hooks/session-recovery/ — 세션 에러 자동 복구

**생성일:** 2026-04-11

## 개요

16개 파일 + storage/ 서브디렉토리. `session.error` 이벤트를 처리하는 Session 계층 훅. 복구 가능한 에러 타입을 감지하고, 타겟 복구 전략을 적용하며, 세션을 투명하게 재개.

## 복구 전략

| 에러 타입 | 파일 | 복구 동작 |
|------------|------|-----------------|
| `tool_result_missing` | `recover-tool-result-missing.ts` | 저장소에서 누락된 도구 결과 재구성 |
| `thinking_block_order` | `recover-thinking-block-order.ts` | 잘못된 사고 블록 재정렬 |
| `thinking_disabled_violation` | `recover-thinking-disabled-violation.ts` | 비활성화 시 사고 블록 제거 |
| `empty_content_message` | `recover-empty-content-message*.ts` | 빈/null 콘텐츠 블록 처리 |

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `hook.ts` | `createSessionRecoveryHook()` — 에러 감지, 전략 디스패치, 재개 |
| `detect-error-type.ts` | `detectErrorType(error)` → `RecoveryErrorType \| null` |
| `resume.ts` | `resumeSession()` — 세션 컨텍스트 재구성, 재시도 트리거 |
| `storage.ts` | 복구 재구성을 위한 세션별 메시지 저장 |
| `recover-tool-result-missing.ts` | 저장된 메타데이터로부터 도구 결과 재구성 |
| `recover-thinking-block-order.ts` | 잘못된 사고 블록 시퀀스 수정 |
| `recover-thinking-disabled-violation.ts` | 모델 컨텍스트에서 사고 블록 제거 |
| `recover-empty-content-message.ts` | 빈 어시스턴트 메시지 처리 |
| `recover-empty-content-message-sdk.ts` | 빈 콘텐츠 복구의 SDK 변형 |
| `types.ts` | `StoredMessageMeta`, `StoredPart`, `ResumeConfig`, `MessageData` |

## STORAGE 서브디렉토리

```
storage/
  ├── message-store.ts    # 인메모리 + 파일 메시지 캐시
  ├── part-store.ts       # 개별 메시지 부분 저장
  └── index.ts            # 배럴 export
```

복구 재구성을 위해 세션별 메시지 메타데이터와 부분을 저장.

## 훅 인터페이스

```typescript
interface SessionRecoveryHook {
  handleSessionRecovery: (info: MessageInfo) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (cb: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (cb: (sessionID: string) => void) => void
}
```

## 노트

- `processingErrors` Set으로 같은 에러에 대한 중복 복구 시도 방지
- 동작 플래그를 위한 `experimental` 설정 지원
- `anthropic-context-window-limit-recovery`와 구별됨 (그 훅은 토큰 한계 처리; 이 훅은 구조적 에러 처리)
