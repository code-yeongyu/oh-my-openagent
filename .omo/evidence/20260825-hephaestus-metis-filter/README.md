# Issue #6318: Hephaestus can still invoke Metis after Metis is filtered from its delegation table

Date: 2026-08-25
Branch: issue/6318-hephaestus-metis-filter (base: dev @c7094b8ac)

## Root cause

Hephaestus's delegation table is filtered at prompt-build time only:

- `packages/omo-opencode/src/agents/hephaestus/gpt-5-6.ts:190-194` and
  `packages/omo-opencode/src/agents/hephaestus/gpt-5-5.ts:247-251` filter
  `availableAgents` to `["explore", "librarian", "oracle"]`, so the prompt table
  omits metis (and every other non-allowlisted agent).
- `packages/omo-opencode/src/tools/delegate-task/subagent-request-preflight.ts`
  (`validateSubagentRequest`) validated sisyphus-junior direct use, plan-family
  mutual blocking, and coordinator targets, but had no Hephaestus allowlist
  restriction, so a direct `task(subagent_type="metis")` request from a
  Hephaestus session still resolved and spawned.

## Change

- `tools/delegate-task/constants.ts`: new single source of truth
  `HEPHAESTUS_DELEGATION_ALLOWLIST = ["explore", "librarian", "oracle"]` plus
  `isHephaestusAgent()` (getAgentConfigKey normalization, so canonical key,
  display name, and legacy aliases like "Hephaestus (Deep Agent)" all match).
- `tools/delegate-task/subagent-request-preflight.ts`: after the coordinator
  guard, requests whose parent agent is Hephaestus and whose target is outside
  the allowlist are rejected with an error naming the agent, the allowed
  subagent types, and the category alternative.
- `agents/hephaestus/gpt-5-6.ts` + `gpt-5-5.ts`: the delegation-table filters now
  consume `HEPHAESTUS_DELEGATION_ALLOWLIST` instead of inline arrays, so the
  advertised table and the invocation-time enforcement cannot drift.

Scope note: category-based delegation (sisyphus-junior via `category=`) does not
go through this preflight branch and is unchanged; `task_id` continuations resume
an already-resolved session and are intentionally not re-filtered. Non-Hephaestus
parents keep existing behavior (guard is scoped to `parentAgent=hephaestus`).

## WHAT WAS TESTED

1. Failing-first proof against the unpatched tree: ran
   `bun test packages/omo-opencode/src/tools/delegate-task/hephaestus-delegation-allowlist.test.ts`
   before implementing (only the test file existed) -> module error because
   `HEPHAESTUS_DELEGATION_ALLOWLIST` did not exist yet (`before-fail.txt`).
2. After the fix, same command plus the coordinator guard suite
   (`after-pass-new-tests.txt`).
3. Scoped suites for the full blast radius:
   `bun test packages/omo-opencode/src/tools/delegate-task/ packages/omo-opencode/src/agents/hephaestus/`
   (`scoped-suite.txt`), plus
   `bun test packages/omo-opencode/src/features/team-mode/team-runtime/`
   (48 pass / 0 fail; resolve-member.ts consumes resolveSubagentExecution).
4. Repo typecheck gate: `bun run typecheck` (tsgo root + script + all packages).

## WHAT WAS OBSERVED

- Failing first: 0 pass / 1 fail / 1 error (missing export on unpatched base).
- After fix: new tests 8 pass / 0 fail; coordinator guard 6 pass / 0 fail
  (14 total across both files).
- Scoped sweep: 540 pass / 0 fail across 47 files (delegate-task + hephaestus).
- Team-mode team-runtime: 48 pass / 0 fail across 8 files.
- `bun run typecheck`: exit 0, all three stages clean (`typecheck.txt`).

## WHY IT IS ENOUGH

The regression tests pin the exact seam the issue reproduces through:
`resolveSubagentExecution` with `parentAgent="hepaestus"` (the task tool's real
invocation path). They prove filtered agents (metis, momus, multimodal-looker)
are rejected, allowlisted agents (explore/librarian/oracle) still proceed past
the guard, legacy display aliases of the parent normalize correctly, and other
parents (sisyphus) are unaffected. The full delegate-task directory sweep covers
every consumer of the changed preflight, including sync/background execution,
continuations, and category routing. Team-mode member resolution was swept
because it shares `resolveSubagentExecution`.

## WHAT WAS OMITTED

Live OpenCode harness QA (opencode-qa skill: TUI smoke, SSE hook probe, DB
isolation) was not driven; coverage is unit + typecheck level consistent with
prior art (#7202, #7227) for the same subsystem. The change adds one pure
validation branch to the task preflight; no hook, config schema, MCP, CLI
command, or installer changed. Residual risk: a Hephaestus session resuming an
existing task via `task_id` is not re-filtered (by design; the agent was already
resolved at launch). No secrets, tokens, env dumps, or auth headers appear in
the captured output.
