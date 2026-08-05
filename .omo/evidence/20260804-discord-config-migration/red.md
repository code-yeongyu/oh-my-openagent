# Failing-First Evidence

Base: `origin/dev` commit `b33a4250fa37973cd144947abb4db7ea0c13746e`
Branch: `fix/config-migration-model-chains`

## Migrated canonical agent model chain

Command:

```text
bun test packages/omo-opencode/src/config/validate.test.ts -t 'migrated canonical agent model chain'
```

Observed RED:

```text
Expected: []
Received:
[
  ".../.omo/omo.jsonc: Unknown config key: agents.explore.models",
]

0 pass
1 fail
```

Binary verdict: FAIL, for the reported reason. The reasoning-unification migration emits `agents.*.models`, but the OpenCode plugin config surface rejects that key.

## Doctor plugin-harness warnings

Command:

```text
bun test packages/omo-opencode/src/cli/doctor/checks/deprecated-reasoning-keys.test.ts -t 'ignores plugin-supported'
```

Observed RED:

```text
Expected only:
  categories.deep.variant

Received additional warnings:
  [opencode].agents.explore.variant
  [opencode].agents.explore.fallback_models

0 pass
1 fail
```

Binary verdict: FAIL, for the reported reason. The doctor scanner applies canonical migration guidance inside the OpenCode plugin block where `variant` and `fallback_models` remain supported runtime keys.

## Environment correction

The first attempted test run failed before assertions because the fresh worktree lacked complete workspace package links. `bun install --force --ignore-scripts` repaired the isolated worktree dependency graph. That environment failure is not counted as RED evidence.

## Cleanup

- Test fixtures use temporary directories and remove them in `finally`.
- No process, server, port, container, or tmux session was created.
- The dirty main checkout was not modified.

## Self-review adjacent-harness RED

The first doctor implementation skipped every harness block. A new assertion required canonical `[senpi]` and `[codex]` blocks to remain scanned while `[opencode]` stays exempt.

Observed before narrowing:

```text
Expected:
  [senpi].agents.explore.variant
  [codex].categories.deep.fallback_models

Received neither entry.

0 pass
1 fail
```
