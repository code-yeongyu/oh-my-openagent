# src/hooks/session-recovery/ — Auto Session Error Recovery

**Generated:** 2026-02-24

## OVERVIEW

16 files + storage/ subdir. Session Tier hook handling `session.error` events. Detects recoverable error types, applies targeted recovery strategies, and resumes the session transparently.

## RECOVERY STRATEGIES

| Error Type | File | Recovery Action |
|------------|------|-----------------|
| `tool_result_missing` | `recover-tool-result-missing.ts` | Reconstruct missing tool results from storage |
| `thinking_block_order` | `recover-thinking-block-order.ts` | Reorder malformed thinking blocks |
| `thinking_disabled_violation` | `recover-thinking-disabled-violation.ts` | Strip thinking blocks when disabled |
| `empty_content_message` | `recover-empty-content-message*.ts` | Handle empty/null content blocks |

## KEY FILES

| File | Purpose |
|------|---------|
| `hook.ts` | `createSessionRecoveryHook()` — error detection, strategy dispatch, resume |
| `detect-error-type.ts` | `detectErrorType(error)` → `RecoveryErrorType \| null` |
| `resume.ts` | `resumeSession()` — rebuild session context, trigger retry |
| `storage.ts` | Per-session message storage for recovery reconstruction |
| `recover-tool-result-missing.ts` | Reconstruct tool results from stored metadata |
| `recover-thinking-block-order.ts` | Fix malformed thinking block sequences |
| `recover-thinking-disabled-violation.ts` | Remove thinking blocks from model context |
| `recover-empty-content-message.ts` | Handle empty assistant messages |
| `recover-empty-content-message-sdk.ts` | SDK variant for empty content recovery |
| `types.ts` | `StoredMessageMeta`, `StoredPart`, `ResumeConfig`, `MessageData` |

## STORAGE SUBDIRECTORY

```
storage/
  ├── message-store.ts    # In-memory + file message cache
  ├── part-store.ts       # Individual message parts storage
  └── index.ts            # Barrel export
```

Stores message metadata and parts per session for recovery reconstruction.

## HOOK INTERFACE

```typescript
interface SessionRecoveryHook {
  handleSessionRecovery: (info: MessageInfo) => Promise<boolean>
  isRecoverableError: (error: unknown) => boolean
  setOnAbortCallback: (cb: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (cb: (sessionID: string) => void) => void
}
```

## NOTES

- Guards with `processingErrors` Set to prevent duplicate recovery attempts on same error
- Supports `experimental` config for behavior flags
- Distinct from `anthropic-context-window-limit-recovery` (handles token limit; this handles structural errors)
