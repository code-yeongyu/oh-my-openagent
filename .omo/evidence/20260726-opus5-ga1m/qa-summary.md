# Claude Opus 5 GA 1M context QA

## What was tested

- Loaded this branch's `packages/omo-opencode/src/index.ts` in a real OpenCode server under isolated XDG data, config, cache, and state directories.
- Queried `/global/health` and `/config` to verify that the real harness became healthy with this worktree plugin source configured.
- Added a production-hook regression test for the preemptive-compaction path. The same `claude-opus-5` session remains below the 78% threshold at 200,000 input and cache-read tokens, then triggers exactly one summarize call at 790,000 tokens.
- Ran the focused resolver and preemptive-compaction suites.
- Ran package TypeScript checks with `bun run typecheck:packages`.

## What was observed

- Real OpenCode v1.18.5 reported `healthy: true` with the worktree plugin URI present in `/config`.
- The real OpenCode database session count stayed at 4,329 before and after the isolated server run.
- Focused tests: 32 pass, 0 fail. This includes `claude-opus-5`, the 5-series `-high` variants, genuine 200K-model guards, and the production compaction decision path.
- Package typecheck exited successfully.

Exact captured output:

- `opencode-source-load.txt`
- `focused-tests.txt`
- `typecheck-packages.txt`

## Why it is enough

The resolver tests pin the model-ID classification, while the hook-level test pins the user-visible consequence: 200K usage must not cause premature compaction for a GA 1M Opus 5 session, and usage above 78% of 1M must still compact. The isolated OpenCode run verifies that the changed source tree loads in the real harness without touching the user's OpenCode state.

## What was omitted

No provider request was needed because this behavior is a deterministic local compaction decision over OpenCode message usage metadata. No credentials, environment dumps, auth headers, or private configuration were captured. The isolated server used localhost only and its sandbox was removed after capture.
