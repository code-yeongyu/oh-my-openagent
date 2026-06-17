# Silent Fallback Guard Integration Note

## Decision

V1 placement is a first-class lifecycle hook under `packages/omo-opencode/src/hooks/silent-fallback-guard/`. It is registered in the session hook composer and dispatched via the existing event hook dispatcher. This avoids the experimental `.omx/hooks/*.mjs` plugin path and aligns with the upstream factory/composer architecture.

The hook remains opt-in through two gates:

1. The hook must not be listed in `disabled_hooks`.
2. `silent_fallback_guard.enabled` must be `true` in `.opencode/oh-my-openagent.jsonc`.

If either gate is off, the hook returns immediately and does not scan or intervene.

## Verified Hook Surface

Upstream `dev` exposes the required first-class hook integration path:

- `packages/omo-opencode/src/plugin/hooks/create-session-hooks.ts` composes session lifecycle hooks and gates them with `isHookEnabled(...)` and config flags.
- `packages/omo-opencode/src/plugin/event-hook-dispatcher.ts` dispatches `session.idle` events to each registered hook in order.
- `packages/omo-opencode/src/plugin/event.ts` handles `session.idle` and normalizes synthetic idle events.
- `packages/omo-opencode/src/shared/prompt-async-gate.ts` re-exports `dispatchInternalPrompt` and `isInternalPromptDispatchAccepted`, the required path for injecting a review prompt back into a live session.
- `packages/omo-opencode/src/config/schema/hooks.ts` lists the hook name allowlist used by `disabled_hooks`.
- `packages/omo-opencode/src/config/schema/oh-my-opencode-config.ts` is the root config schema where `silent_fallback_guard` is added.

## Trigger And Payload

V1 primary trigger is `session.idle` (the closest available upstream event to a completed agent turn). Do not use `session.deleted` as the primary trigger because it fires too late to inject a review prompt before final completion; keep `session.deleted` only as a rejected option or a future report-only backup.

For verification purposes: `session.deleted` only as a rejected option or backup, never the V1 primary trigger.

The guard's event handler checks `event.type === "session.idle"`, resolves the session ID from the event properties, and then computes its own diff hash from the supported staged and unstaged patches. Do not rely on hook lifecycle dedupe alone for guard review dedupe because the guard needs repeated idle events with unchanged code diff to avoid repeated prompts.

## Diff Source

The diff source is exactly:

- `git diff --no-color -- *.ts *.tsx *.js *.jsx *.py`
- `git diff --cached --no-color -- *.ts *.tsx *.js *.jsx *.py`

Both commands are run in `ctx.directory`. Untracked files are not scanned in V1 and should be reported as skipped in the guard report.

## Dedupe State Storage

Guard dedupe state is held in memory per hook instance, keyed by session ID:

- `reviewedHashesBySession: Map<string, Set<string>>` tracks diff hashes already reviewed for each session.
- This avoids repeated prompts for the same diff and keeps V1 stateless on disk.
- Report bookkeeping is written to `.omo/state/hooks/silent-fallback-guard/report.json` for human inspection.

The V1 dedupe key is a stable SHA-256 hash of the merged supported-language diff. Persist only the hash, not raw diff bodies.

## Intervention Mechanism

Preferred intervention is `dispatchInternalPrompt({ mode: "async", client: ctx.client, sessionID, source: "silent-fallback-guard", ... })` with a follow-up prompt that asks the active session to review the Silent Fallback Guard report before completing. The prompt uses `createInternalAgentTextPart(...)` for the body and is queued with `queueBehavior: "defer"`.

The prompt includes:

- The guard report path.
- Candidate summary and budget/saturation status.
- Checklist: review every selected candidate, remove only obvious unrequested fallback slop, keep justified fallback behavior, ask the user with numbered options when context is insufficient, and report final decisions.

If `isInternalPromptDispatchAccepted(promptResult)` returns false, the guard logs the status and falls back to report-only mode.

## Prompt-Unavailable Fallback

When internal prompt dispatch is unavailable or rejected, V1 must fail open and become report-only. The hook still writes the local guard report and logs a summary, then returns successfully so normal completion is not blocked.

Report-only fallback behavior:

- Do not inject a follow-up prompt.
- Do not block or fail the hook dispatch.
- Record the report path, diff hash, candidate counts, and saturation status.
- Surface the status via the logger.

## Configuration

Enable the guard in `.opencode/oh-my-openagent.jsonc`:

```jsonc
{
  "silent_fallback_guard": {
    "enabled": true,
    "mode": "report",        // "report" or "pushback"
    "max_review_candidates": 20,
    "max_per_file": 5,
    "max_per_risk_type": 8,
    "include_low_confidence": false,
    "supported_languages": ["javascript", "typescript", "python"]
  }
}
```

All fields are optional and default to safe disabled-by-default values.
