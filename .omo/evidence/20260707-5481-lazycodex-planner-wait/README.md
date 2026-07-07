# QA Evidence: LazyCodex planner result wait barrier

## What was tested

- RED/GREEN hook contract: `npm --prefix packages/omo-codex/plugin/components/ultrawork test -- test/codex-hook.test.ts`.
- RED/GREEN planner skill contract: `node --test packages/omo-codex/plugin/test/ulw-plan-skill-contract.test.mjs`.
- Review follow-up RED/GREEN contracts for wave-level spawning:
  - `npm --prefix packages/omo-codex/plugin/components/ultrawork test -- test/codex-hook.test.ts`
  - `node --test packages/omo-codex/plugin/test/ulw-plan-skill-contract.test.mjs`
- Component regression: `npm --prefix packages/omo-codex/plugin/components/ultrawork test`.
- Generated skill sync and pointer checks:
  - `node --test packages/omo-codex/plugin/test/aggregate-skills.test.mjs packages/omo-codex/plugin/test/ultrawork-skill-pointer.test.mjs packages/omo-codex/plugin/test/ulw-plan-skill-contract.test.mjs`
  - `node --test --test-name-pattern "component skill sources|shared skill name collides|packaged ulw-plan|context-pressure-prone" packages/omo-codex/plugin/test/sync-skills.test.mjs`
- Type/lint guardrails:
  - `npm --prefix packages/omo-codex/plugin/components/ultrawork run typecheck`
  - `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/omo-codex/plugin/components/ultrawork/test/codex-hook.test.ts`
  - `bun run typecheck`
  - `git diff --check`
- Codex QA skill attempts:
  - `bash scripts/lib/common.sh --self-check`
  - `bash scripts/hook-unit-probe.sh --self-test`
  - `bash scripts/app-server-drive.sh --plugin`
- Codex compatibility gate: `bun run test:codex` before and after `bun install --frozen-lockfile`, plus a sanitized-PATH retry excluding the user-global npm shim.

## What was observed

- The hook contract failed before the prompt edit because the injected directive did not require waiting after `multi_agent_v1.spawn_agent`; it passed after the edit with 14/14 tests green.
- The planner skill contract failed before the skill edit because `ulw-plan` did not document `multi_agent_v1.wait_agent`; it passed after the edit for both component and packaged skill copies.
- The review follow-up contracts failed before changing the wording because the prompt still serialized child launches with "Immediately after any `multi_agent_v1.spawn_agent`". They pass after the wording now requires spawning every independent child in the current wave first, then waiting each child to terminal status before dependent planning or handoff.
- The ultrawork component suite passed: 5 files, 31 tests.
- Focused generated-skill and pointer checks passed after rebuilding `ultrawork` and `ulw-loop`: 8/8 tests and 4/4 focused sync tests.
- Typecheck passed at both component and repository level. No-excuse audit and `git diff --check` passed.
- Codex QA isolation self-check confirmed isolated `CODEX_HOME`, mock model response, and unchanged real `~/.codex/config.toml`, but failed host dependency checks because `jq` and `tmux` are not installed.
- `hook-unit-probe.sh --self-test` and `app-server-drive.sh --plugin` are blocked on the same missing `jq` dependency.
- `bun run test:codex` is partially blocked by this Windows host environment:
  - Default PATH fails in `packages/lsp-tools-mcp/test/process.test.ts` because `%APPDATA%/npm` contains a global `typescript-language-server.CMD` shim.
  - Sanitized PATH fixes that LSP MCP failure, then the gate reaches unrelated installer cleanup and LSP component package-smoke failures captured in `bun-test-codex-sanitized-path-standalone-bun.txt`.

## Why it is enough

The changed behavior is prompt/skill contract text for Codex orchestration. The RED/GREEN tests prove the injected ultrawork directive and both `ulw-plan` copies now require `wait_agent` to terminal status before dependent work can proceed, while preserving parallel launch of independent children in the same wave. The component, sync, pointer, typecheck, and diff checks prove the generated runtime copies stay aligned and the changed TypeScript test is clean.

## What was omitted

Full live Codex app-server proof could not run on this host because the `codex-qa` scripts require `jq`; TUI smoke also requires `tmux`. No secret-bearing logs or environment dumps were copied.

## CI follow-up: keep wait-agent liveness framing

GitHub codex-compatibility failed after the wave-level fix because
`sync-skills-orchestration.test.mjs` requires every skill that documents
`multi_agent_v1.wait_agent` to also keep progress-oriented liveness guidance.
The follow-up restores the `WORKING:` / `BLOCKED:` contract, frames wait-agent
timeouts as mailbox silence, and keeps explicit fallback conditions while
preserving the wave-level spawn barrier.

Additional captured commands:

- RED: `node --test packages/omo-codex/plugin/test/sync-skills-orchestration.test.mjs`
- GREEN: `node --test packages/omo-codex/plugin/test/sync-skills-orchestration.test.mjs`
- GREEN contract: `node --test packages/omo-codex/plugin/test/ulw-plan-skill-contract.test.mjs`
- GREEN generated/orchestration set: `node --test packages/omo-codex/plugin/test/aggregate-skills.test.mjs packages/omo-codex/plugin/test/ultrawork-skill-pointer.test.mjs packages/omo-codex/plugin/test/ulw-plan-skill-contract.test.mjs packages/omo-codex/plugin/test/sync-skills-orchestration.test.mjs`
- No-excuse audit: `rg -n "as any|@ts-ignore|@ts-expect-error" packages/omo-codex/plugin/test/ulw-plan-skill-contract.test.mjs`
- `bun run typecheck`
- `git diff --check`
