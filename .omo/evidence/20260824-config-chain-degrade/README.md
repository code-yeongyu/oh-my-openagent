# PR-B: Config-chain surgical degradation — QA evidence

Date: 2026-08-25
Branch: `fix/config-chain-surgical-degradation`
Worktree: `.local-ignore/pr-config-chain`
Plan: `.omo/plans/20260824-configchain-wake-openai-fix.md` PR-B (B1→B4)
Brief: `.omo/tasks/pr-b-delegation.md`

## WHAT WAS TESTED

The config-chain surgical-degradation change: when a user config contains an
invalid record leaf (`agents.<name>` / `categories.<name>`), the loader prunes
only the offending leaf and keeps healthy siblings, instead of wholesale
falling back to `DEFAULT_RAW_CONFIG`.

Surfaces driven:
1. Unit: `bun test packages/omo-config-core` (loader-prune.test.ts hard-invariant
   tests) and `bun test packages/omo-opencode/src/config` (core-schema-parity.test.ts
   drift guard).
2. Type: `tsgo --noEmit -p packages/omo-config-core/tsconfig.json` and
   `packages/omo-opencode/tsconfig.json`; full `bun run typecheck`.
3. Root suite: `bun test` (15624 pass / 45 fail — all pre-existing base-branch
   or environment defects in unrelated modules, see OMITTED).
4. Codex gate: `bun run test:codex` — blocked by a pre-existing dependency
   defect (see OMITTED); the codex-codegraph typecheck that consumes
   `omo-config-core` through the codex closure passes clean.
5. opencode-qa CLI case in `script/agent/qa-sandbox.sh` isolation with a
   PROJECT-LAYER fixture `<tmp-project>/.omo/omo.jsonc` (never `~/.omo/**`).

## WHAT WAS OBSERVED

### Loader surgical pruning (deterministic, exact QA fixture)

Fixture `<tmp-project>/.omo/omo.jsonc`:
```jsonc
{
  "agents": {
    "sisyphus": { "model": "anthropic/claude-opus-5", "prompt_append": "QA-OVERRIDE-MARKER" },
    "oracle": { "model": "kimi-k3", "bogus_key": 1 }
  }
}
```

`loadOmoConfig` probe result:
- `sisyphus.model` = `anthropic/claude-opus-5`  (SURVIVES)
- `sisyphus.prompt_append` = `QA-OVERRIDE-MARKER`  (SURVIVES)
- `oracle` present = false  (DROPPED)
- diagnostics = exactly one validation diagnostic:
  `Dropped invalid agents.oracle leaf: agents.oracle: Unrecognized key: "bogus_key"`,
  path `agents.oracle`, issuePaths `["agents.oracle"]`

### Isolation proof

`opencode run` was executed inside `script/agent/qa-sandbox.sh` isolation
(XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME/XDG_STATE_HOME remapped to a
`mktemp` sandbox). The run wrote its session to the sandbox DB
(`/tmp/omo-qa-sandbox.*/data/opencode/opencode.db`, 1 session) — the real
`~/.local/share/opencode/opencode.db` was never touched. `HOME` inside the
sandbox is `/home/ubuntu` (NOT remapped), so the fixture was deliberately placed
at a project layer `<tmp-project>/.omo/omo.jsonc` outside `$HOME`, per the
amended B4 bullet.

### Unit + typecheck

- `bun test packages/omo-config-core`: 181 pass / 0 fail
- `bun test packages/omo-opencode/src/config`: 163 pass / 0 fail
- `tsgo --noEmit` (config-core + omo-opencode): clean
- `bun run typecheck`: EXIT 0
- codex-codegraph typecheck (consumes omo-config-core): clean after the
  `@types/node` env fix

### Schema freshness

B1 added `permission`/`prompt_append` keys to the core agent schema; the
generated `assets/omo.schema.json` was regenerated (`bun run build:omo-schema`)
so `tests/omo-schema-freshness.test.ts` stays green (3 pass). The diff is only
the expected `permission`/`prompt_append` additions.

## WHY IT IS ENOUGH

- The hard-invariant test (`loader-prune.test.ts`) and the direct `loadOmoConfig`
  probe both prove the exact acceptance criterion: a bad `agents.oracle` leaf
  never drops the healthy `agents.sisyphus`, and produces exactly one
  per-key diagnostic.
- The drift guard (`core-schema-parity.test.ts`) proves the core schema and the
  OpenCode adapter schema stay in field parity for `permission`/`prompt_append`
  (agents) and full category parity — the failure mode (future key addition on
  one side without the other) fails CI.
- The prune loop is bounded (`maxIterations = droppedGroups + 1`) AND total
  (falls back to defaults when non-prunable paths remain), per the Global
  Constraints.
- Isolation is proven: the opencode run used the sandbox XDG paths; the real DB
  was untouched.

## WHAT WAS OMITTED

- Root `bun test` 45 failures: all in modules unrelated to this change
  (auto-update-checker network tests, codex/senpi installers, dist-bundle prompt
  content, telemetry, skill-loader short-name resolution, claude-code-agent-loader,
  codex-components doctor). These are pre-existing base-branch/environment
  defects; none touch `omo-config-core` loader/schema or the adapter config
  schema. The only failure in this change's blast radius (`omo schema
  freshness`) was fixed by regenerating the schema.
- `bun run test:codex` is blocked by a pre-existing dependency defect: the
  committed `packages/omo-codex/plugin` lockfile does not install `@types/node`,
  which the `ulw-loop`/`codegraph` components declare in devDependencies, so
  their `tsc` build fails with TS2688 in a clean checkout. This is independent of
  this change. Proof of attempt: `test:codex` run fails deterministically at the
  `npm --prefix packages/omo-codex/plugin ci` → `components/ulw-loop build` step;
  installing `@types/node --no-save` makes the codex-codegraph typecheck (the
  part that consumes `omo-config-core` through the codex closure) pass. The
  change's own gate (unit + typecheck + codex-closure typecheck) is green.
- `opencode run` in the sandbox returned "Unexpected server error" because no
  provider/model credentials are configured in the isolated environment to
  answer a prompt. This is an environment limitation, not a code failure; the
  loader's surgical-pruning behavior is deterministically proven by the unit
  probe above.
- Redacted: no secrets, credentials, or auth headers captured. Sandbox temp
  paths are ephemeral and removed after QA.
