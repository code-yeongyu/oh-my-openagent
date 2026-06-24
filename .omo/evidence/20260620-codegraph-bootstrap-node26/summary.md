# CodeGraph Bootstrap Node 26 Evidence

## Regression

- `focused-component-checks.txt` records `bun run typecheck`, `bun run build`, and `bun run test` for `packages/omo-codex/plugin/components/codegraph`.
- `focused-component-checks-after-test-split.txt` records the focused typecheck and component test rerun after moving Node-support worker cases into `test/session-start-node-support.test.ts`.
- `../pr-5448-code-review.md` and `../pr-5448-security-safety-code-review.md` record explicit programming/remove-ai-slops and security review perspectives.
- `test-codex.txt` records the full `bun run test:codex` gate. It completed with 354 passing Node tests and no failures.
- `codex-qa-common-self-check.txt` proves the Codex QA isolation helpers pass.
- `codex-qa-hook-unit-probe.txt` proves the deterministic hook probe still passes.
- `codex-qa-app-server-plugin.json` proves a live isolated `codex app-server` turn completed, the real `~/.codex/config.toml` stayed unchanged, and plugin hooks fired.

## Intended Behavior

`node26-worker-repro.txt` drives the real built CodeGraph SessionStart worker under Node `v26.0.0` with isolated `HOME` and workspace. The worker outcome is:

```json
{"source":"provisioned","action":"initialized"}
```

The same artifact then runs provisioned CodeGraph `status --json` in the sandbox workspace and observes `"initialized": true`. The workspace `.codegraph` link points into the isolated `HOME/.omo/codegraph/projects/...` global store.
