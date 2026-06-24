# Main Dirty Cleanup Evidence

Date: 2026-06-18

## Kept

- `packages/model-core/src/model-availability.test.ts`: meaningful regression coverage. It failed before the fix because model-core only normalized Claude version separators.
- `packages/model-core/src/model-availability.ts`: updated to normalize Kimi, GLM, and GPT dot/dash version separators consistently with the OpenCode adapter implementation.
- `packages/omo-opencode/src/hooks/atlas/index.test.ts`: meaningful test isolation. It clears prompt-async reservations before and after each Atlas test case.

## Removed As Noise

- `packages/omo-opencode/src/shared/model-availability-fuzzy.test.ts`: duplicate of existing coverage in `packages/omo-opencode/src/shared/model-availability.test.ts`.
- `packages/omo-opencode/src/shared/connected-providers-cache-shrink.test.ts`: duplicate of existing coverage in `packages/omo-opencode/src/shared/connected-providers-cache.test.ts`.
- `packages/skills-loader-core/src/features/opencode-skill-loader/loader-shared-precedence.test.ts`: duplicate of stronger existing coverage in `loader-deduplication.test.ts`; the new file also asserted outdated description/scope formatting.
- `packages/omo-opencode/src/features/tui-sidebar/config-validator.test.ts`: shallow smoke that only asserted `result.config` exists.

## Verification

- `bun test packages/model-core/src/model-availability.test.ts` -> 3 pass.
- `bun test packages/omo-opencode/src/hooks/atlas/index.test.ts` -> 73 pass.
- `bun test packages/omo-opencode/src/shared/connected-providers-cache.test.ts` -> 11 pass.
- `bun test packages/skills-loader-core/src/features/opencode-skill-loader/loader-deduplication.test.ts` -> 8 pass.
- LSP diagnostics for changed files -> no diagnostics found:
  - `packages/model-core/src/model-availability.ts`
  - `packages/model-core/src/model-availability.test.ts`
  - `packages/omo-opencode/src/hooks/atlas/index.test.ts`

## OpenCode QA

Command:

```bash
script/agent/qa-docker.sh exec bash .agents/skills/opencode-qa/scripts/tui-smoke.sh --self-test
```

Result:

- TUI rendered under tmux in disposable Docker QA container.
- `send-keys` reached the TUI composer.
- tmux session was torn down.
- Real DB remained untouched: session count `0` unchanged.
