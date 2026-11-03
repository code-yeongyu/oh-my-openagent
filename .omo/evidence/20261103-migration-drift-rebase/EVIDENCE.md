# QA Evidence: rebased migration-drift fix (tolerance + schema sync + parity guard)

Date: 2026-11-03 | Base: dev@72a6bae47e | Branch: fix/migration-validate-tolerate-existing-keys (rebased)

## WHAT WAS TESTED

Rebase of #8087 onto current dev, extended with the plan agreed in the PR thread:

1. Tolerance (`migration/commit.ts`): `validateTarget()` accepts zod `unrecognized_keys` issues only when
   every flagged key pre-exists at the same path in the migration target; emits
   `kept: <path> (unknown to migration schema, pre-existing in target, preserved verbatim)` diagnostics.
   Additions-introduced unknown keys, unsafe keys, and prototype tampering stay fail-closed. Runs after
   `stripRetiredCodegraph`, so retired keys are still removed with `removed:` diagnostics, never kept.
2. Schema sync (`schema/agent.ts`): the 13 per-agent keys documented in `docs/reference/configuration.md`
   and accepted by the adapter `AgentOverrideConfigSchema` are now first-class in `OmoConfigSchema`
   (camelCase inputs `maxTokens`/`providerOptions`/`thinking`/`textVerbosity` normalize via
   `normalizeLegacyModelFields` to canonical `max_tokens`/`provider_options`). `allow_non_gpt_model` added
   as a shared optional.
3. Parity guard: `packages/omo-opencode/src/config/schema/core-schema-parity.test.ts` now probes EVERY
   adapter agent key against core (the category direction was already pinned; the agent direction was the
   hole that let the drift bite users).
4. Regenerated committed artifacts: `packages/omo-codex/scripts/install-dist/install-local.mjs` (embeds the
   synced agent schema) and `packages/omo-senpi/plugin/extensions/*` (provenance headers + omo.js logic).

## WHAT WAS OBSERVED

- Real surface, BEFORE (source files reverted to dev@72a6bae47): `runOpenCodeStartupMigration()` against an
  isolated replica HOME (`qa-driver.ts`, fixture carries `agents.sisyphus.ultrawork/compaction`,
  `agents.hephaestus.allow_non_gpt_model`, an unknown `some_future_key`, and retired `[codex].codegraph`)
  printed the user-reported error verbatim: `Migration validation failed ... Unrecognized keys: "ultrawork",
  "compaction", "some_future_key" ...` and migrated nothing (`qa-01-before-fix.txt`).
- Real surface, AFTER: `error: null`; plans `migrated`; diagnostics carry `removed: [codex].codegraph
  (retired configuration)` and `kept: agents.sisyphus.some_future_key (...)`; the synced documented keys
  pass validation silently (no `kept:` — they are now recognized); all agent keys preserved verbatim in the
  target and `_migrations` markers written (`qa-02-after-fix.txt`).
- Hermetic gates: `bun test packages/omo-config-core` 385 pass / 0 fail; parity + agent-overrides suites
  5+3 pass; `tsgo --noEmit -p packages/omo-config-core/tsconfig.json` exit 0;
  `node --test packages/omo-codex/scripts/install-generated-bundle.test.mjs` 7 pass / 0 fail;
  `build:senpi-plugin` + `build-extension.mjs --check` + `build-install.mjs --check` all exit 0.
- Parity guard RED->GREEN: with `schema/agent.ts` reverted (git stash), the new agent parity test fails
  1/5; with the sync applied 5/5 pass. This is the future-drift tripwire.
- `bun run test:codex`: ulw-loop component suite 689 pass / 689 on clean re-run (first run flaked once,
  unrelated bootstrap PATH case); one failure in `codex-cache-fingerprint.test.ts` was reproduced on the
  PRISTINE dev tree in this worktree (macOS `/var` -> `/private/var` realpath noise, 3 pass / 1 fail on
  both trees) — environmental, not attributable to this diff.
- Isolation: driver ran only inside `mktemp`-created replica HOMEs under /tmp; the real `~/.omo/omo.jsonc`
  sha256 verified unchanged before and after (`shasum -c` OK). No harness process spawned.

## WHY IT IS ENOUGH

The two user-facing symptoms (startup migration blocked; documented agent keys stripped on load) are both
closed at the schema layer, the remaining unknown-key class can no longer hard-block migrations, and the
parity test prevents recurrence. Fail-closed paths keep their pinned tests (additions-introduced unknown
keys still throw). Retired-key removal semantics of #8694 are untouched and proven by the interaction test.

## WHAT WAS OMITTED

- No secret-bearing logs captured; fixture configs are synthetic. Raw driver stdout is the two
  `qa-0*.txt` artifacts in this directory; `qa-driver.ts` is included for reproduction.
