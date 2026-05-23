# Review Boundary Policy

## CI Gates (Deterministic, Blocking)

The following checks must pass before a PR is considered ready for review:

1. `bun run build` — ESM bundle + declarations + schema generation
2. `bun run typecheck` — tsgo --noEmit
3. `bun test` — All tests pass (pre-existing failures documented separately)
4. Architectural audit tests (`mock-module-lifecycle-audit.test.ts`, `prompt-async-route-audit.test.ts`) pass

## Agent Review (Advisory, Non-Blocking)

Agent-based review (e.g., `review-work` skill launching 5 parallel sub-agents) is:

- **Advisory only** — findings are for human reviewer consideration
- **Async, non-blocking** — does not gate PR merge
- **Optional** — reviewers may skip it

## Review Scope

Agent review operates on:
- ✅ Git diff content
- ✅ File contents
- ✅ Test output

Agent review does NOT touch:
- ❌ Session transcripts
- ❌ User messages or conversation history
- ❌ Log files (`oh-my-opencode.log`)
- ❌ Environment variables
- ❌ API keys or credentials

## Verification Philosophy

- Deterministic checks prove correctness; agent review surfaces risks
- Evidence over assertions — every claim must be traceable to a file, line, and behavioral expectation
- All agent findings must be reproducible via `bun test` or equivalent deterministic command
