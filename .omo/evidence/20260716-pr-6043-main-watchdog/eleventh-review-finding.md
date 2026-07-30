# Eleventh Exact-Head Review Finding

- Reviewed head: `7c06691c5f6caf89307af6b285a16aa33c7f20dd`
- Reviewer: `019f6c00-a51d-7d43-98d7-41d0fc1daff4`
- Verdict: `FINDING HIGH` / `REQUEST_CHANGES`

## Finding

The OpenCode event adapter treated every `message.part.updated` and
`message.part.delta` event as assistant progress. A real user prompt part is
emitted after the user `message.updated` event arms the watchdog, so that user
part immediately cancelled the timer before a silent provider request could be
recovered.

The live event stream demonstrates the ordering:

```text
message.updated role=user
message.part.updated text="Reply exactly QA_FALLBACK_OK"
message.updated role=assistant
```

## Repair

Runtime commit `e2048c0f6464a2cb3a0cc6679ab09b38b6b4ff07`
implements the repair.

The event adapter now forwards `part.messageID` with progress events. The
watchdog ignores ordinary progress associated with its current user message,
while preserving assistant progress, identity-free progress compatibility,
and abort-event correlation.

The failing-first regression in
`packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts`
reproduced the cancellation before the repair: 13 tests passed and the new test
failed because no watchdog abort occurred. The repaired candidate passes the
same regression and the full runtime-fallback suite.

## Verification

- Red proof: `eleventh-review-red-user-part-progress.txt`
- Focused watchdog and related tests: 93 pass, 0 fail
- Full runtime-fallback suite: 277 pass, 0 fail
- OpenCode adapter typecheck: pass
- Scoped Biome audit: pass
- TypeScript no-excuse audit: `No violations in 3 file(s).`
- OpenCode QA harness self-check: pass with isolated sandbox cleanup
- Production-duration isolated OpenCode QA: initial user part did not cancel
  recovery; fallback observed, no fallback watchdog re-arm, later user abort
  external, real database unchanged
