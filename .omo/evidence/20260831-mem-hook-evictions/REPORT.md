# Hook cache eviction TDD evidence (2026-08-31)

Branch: `fix/mem-hook-cache-evictions`
Remote runner: `bun /tmp/omo-mac-test.mjs <branch> -- <paths>`
Local `bun test` was not used.

## RED (SHA `0bf2bbe29`)

Command:

```bash
bun /tmp/omo-mac-test.mjs fix/mem-hook-cache-evictions -- \
  packages/omo-opencode/src/hooks/claude-code-hooks/transcript-prune.test.ts \
  packages/omo-opencode/src/hooks/hashline-edit-diff-enhancer/hook.test.ts \
  packages/omo-opencode/src/hooks/anthropic-context-window-limit-recovery/recovery-hook.test.ts \
  packages/omo-opencode/src/hooks/claude-code-hooks/handlers/session-event-handler.test.ts \
  packages/omo-opencode/src/hooks/keyword-detector/default-mode-session-eviction.test.ts \
  packages/omo-opencode/src/hooks/fsync-skip-warning/eviction.test.ts
```

Result: **9 pass / 9 fail / 1 error** (exit 1)

Snippets:

- transcript: `expect(harness.unrefCalls()).toBe(1)` Expected 1, Received 0
- hashline sweep: `expect(harness.unrefCalls()).toBe(1)` Expected 1, Received 0
- hashline dispose: `expect(afterOutput.metadata).not.toHaveProperty("diff")` received unified diff
- anthropic dispose maps: `expect(executeCompactMock).not.toHaveBeenCalled()` Received 1 call
- session.deleted flags: `sessionFirstMessageProcessed.has("ses_end_flags")` Expected false, Received true
- keyword session.deleted / dispose / cap: toast length Expected 1, Received 0
- fsync: `Export named 'FSYNC_SKIP_START_TTL_MS' not found`
- idle first-message flag test already passed (must not clear on `session.idle`)

## GREEN (SHA `43edd7803`)

Same six files:

```
19 pass
0 fail
Ran 19 tests across 6 files. [384.00ms]
```

Snippets:

- transcript: `(pass) transcript cache idle prune > #given a cached transcript snapshot #when the TTL elapses without another build #then a background sweep drops the entry and temp file`
- hashline: `(pass) hashline pendingCaptures eviction > #given a captured Write old-file body #when the TTL elapses without another Write #then a background sweep drops the capture`
- anthropic: `(pass) ... #given session error payloads retained in maps #when dispose is called #then idle recovery does not keep those payloads`
- session flags: `(pass) ... #given first-message and stop-hook flags #when session.deleted arrives #then both session-id sets are drained`
- keyword: `(pass) ... #when session.deleted arrives #then the next prompt can inject again`
- fsync: `(pass) ... #when the TTL elapses #then a background sweep drops the entry`

## Full hooks scope

Command: `bun /tmp/omo-mac-test.mjs fix/mem-hook-cache-evictions -- packages/omo-opencode/src/hooks`

- this branch SHA `43edd7803`: **2118 pass / 46 fail / 276 files**
- `origin/dev` SHA `3abc23c23`: **2107 pass / 46 fail / 272 files**

The 46 failures are pre-existing on `dev` (same names: runtime-fallback index suite, directory-readme truncation log, sanitizeEmptyMessagesBeforeSummarize). They pass in isolation (`runtime-fallback/index.test.ts` 67 pass / 0 fail) and are cross-file pollution on the shared remote runner, not caused by these cache evictions. New tests: +11 pass.
