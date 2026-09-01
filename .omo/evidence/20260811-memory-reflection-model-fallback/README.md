# Memory reflection executable and model fallback QA

Date: 2026-08-11
Branch: `feat/memory-v2-active-learning`

## What was tested

### Restricted-PATH Senpi executable resolution

The resolver was executed with a PATH containing Node but no Senpi bin directory, then the resolved
command was launched with `--version`.

Observed:

```json
{
  "path": "/opt/homebrew/bin",
  "command": "/Volumes/mengmotaStorage/local-workspaces/omo-wt/feat/memory-v2-active-learning/packages/omo-senpi/node_modules/@code-yeongyu/senpi/dist/cli.js",
  "status": 0,
  "stdout": "2026.8.11-2",
  "stderr": ""
}
```

This reproduces the environment behind
`sandbox-exec: execvp() of 'senpi' failed: No such file or directory` without depending on the
user's PATH, and proves the replacement command is executable.

### Failing-first and mutation-checked fallback behavior

The reflection integration test exposed an extension-only primary and a child-visible fallback.
Before the retry implementation it failed:

```text
Expected: "merged"
Received: "failed"
```

After implementation, the real supervisor integration passed and recorded:

```text
attempts: extension-only/primary, kimi-coding/fallback
completion model: kimi-coding/fallback
outcome: merged
```

Temporarily disabling fallback detection made the same test fail again with `failed`, proving the
test is sensitive to the fix.

The corresponding facts extraction integration also failed first with `failed` and then passed with
the ordered attempts:

```text
extension-only/primary
omo-mock/mock-1
```

### Live Senpi model fallback through the shipped extension

Command:

```text
SENPI_BIN=/Users/yeongyu/.local/bin/senpi \
  bun packages/omo-senpi/scripts/qa/memory-model-fallback-e2e.mjs
```

The driver used:

- a real Senpi parent process,
- the rebuilt git-tracked `plugin/extensions/omo.js`,
- isolated `SENPI_CODING_AGENT_DIR`, session directory, XDG config, and `OMO_MEMORY_HOME`,
- a parent-visible model absent from the clean `--no-extensions` child,
- a child-visible mock fallback provider,
- an event subscription that kept print-mode Senpi alive until reflection completion.

Observed:

```json
{
  "result": "PASS",
  "attempts": [
    "extension-only/primary",
    "omo-mock/mock-1"
  ],
  "outcome": "merged",
  "model": "omo-mock/mock-1"
}
```

The merged memory document contained the fallback reflection sentinel.

### Host config repair

`~/.omo/omo.jsonc` previously pinned `categories.quick.models` to Apitopia and Quotio models that a
clean reflection child could not see. The stale model array was removed while preserving
`prompt_append` and `reasoning`.

The real unified config loader reported:

```json
{
  "diagnostics": [],
  "quick": {
    "reasoning": "off",
    "promptAppend": "string"
  }
}
```

`quick.model` and `quick.models` are both absent, so the child-visible builtin quick chain is used.

### Automated verification

- `bun test packages/omo-senpi/src/components/memory/`
  - final post-review run: 454 passed, 0 failed, 1325 assertions
- `bun run --cwd packages/omo-senpi typecheck`
  - passed
- focused fallback tests
  - canonical stale-registry resolution: passed
  - reflection supervisor fallback: passed
  - facts supervisor fallback: passed
  - retry helper exact-error/generic-error/timeout cases: passed
- `git diff --check`
  - passed
- debug-artifact scan
  - no trace sentinels or debugger statements remained
- pure LOC
  - `facts-runner.ts`: 247
  - `runner.ts`: 249
  - `resolve-model.ts`: 149
  - `memory-model-fallback-e2e.mjs`: 238

## Post-review hardening

Fresh goal, quality, and context reviewers found three gaps in the first fallback implementation:

1. Retry attempts reused one run directory without a durable attempt generation, so reconciliation
   could consume an earlier retryable outcome while a later child was live.
2. Each attempt reset the full timeout instead of sharing one absolute run deadline, and crash
   recovery did not persist the model that actually completed.
3. The PATH-independent resolver returned a path string rather than a cross-platform launcher
   descriptor, and first-turn recovery omitted legacy `model + fallback_models`.

The repaired protocol now persists `attempt`, `model`, `thinking`, `launching`, and one
`hardDeadlineAt` before each child launch. `outcome.json` carries the attempt, and both reflection
and facts reconciliation ignore outcomes whose attempt does not match the current ledger.
The supervisor clears `launching` when it records process ownership. Crash recovery reads the
persisted model and thinking into the completion record.

Failing-first and mutation evidence:

- A live attempt-2 ledger plus stale attempt-1 outcome previously finalized as failed; now
  reconciliation returns active and preserves the worktree.
- A pre-supervisor `launching: true` attempt previously finalized as failed; now it remains active
  until the shared hard deadline.
- Facts reconciliation previously tried to finalize the stale outcome; now it leaves the retry
  active without a warning.
- Forcing `runOutcomeMatchesLedger()` to return true made both reflection and facts stale-outcome
  tests fail. Restoring attempt equality made them green.
- Legacy `model + fallback_models` with a stale availability snapshot previously returned an empty
  fallback list; it now preserves the configured fallback through `registry.find()`.

Cross-platform launch evidence:

- Windows npm shim: `{ command: node.exe, prefixArgs: [dist/cli.js] }`.
- No executable but installed CLI: current interpreter plus `dist/cli.js`.
- Script-hosted current process: current interpreter plus its existing CLI entry script.
- Real restricted PATH with Node but no Senpi bin: the descriptor executed `senpi --version`
  successfully.

## Startup skill warnings

The memory `resources_discover` handler previously contributed `<memory repo>/skills` before that
directory existed, intentionally causing Senpi's visible `skill path does not exist` diagnostic.
The handler now contributes nothing until the directory exists; startup/reload discovers it after a
skill is committed.

The `frontend` collision came from two scanned files declaring `name: frontend`:

- current: `~/.bun/install/global/node_modules/omo-ai/plugin/skills/frontend/SKILL.md`
- stale user copy: `~/.agents/skills/omo-frontend/SKILL.md`

The stale copy was preserved outside scanned roots at:
`~/.agents/skills-disabled/omo-frontend-20260811`.

Exact Senpi loader proof:

- loading current + backed-up stale file produced `name "frontend" collision`;
- loading the current file alone produced zero diagnostics.

Real rebuilt-Omo startup:

```json
{
  "result": "PASS",
  "exit": 0,
  "missingSkillPathWarning": false,
  "frontendCollision": false,
  "skillsPathExists": false
}
```

Captured artifacts:

- `model-fallback-final.log`
- `skill-startup-final.log`
- `final-suite.log`

## Atomic retry transition follow-up

Goal re-review found one remaining interleaving: attempt N could publish a matching retryable
outcome before attempt N+1 was represented in the ledger. Reconciliation in that gap could
finalize the whole run.

Failing-first proof:

- supervisor integration launched a model-not-found child with a configured next attempt;
- expected ledger `{ attempt: 2, launching: true }`;
- received the completed attempt-1 ledger.

Fix:

- `RunLaunchManifest` carries `nextAttempt`;
- the sentinel-owning supervisor evaluates the exact model-not-found predicate;
- before publishing attempt N's outcome, it atomically advances `ledger.json` to attempt N+1 with
  `launching: true`, clears prior process identity, and persists the next model/thinking;
- attempt N's subsequently published outcome is therefore already stale to reconciliation.

Green proof:

- supervisor atomic-handoff integration passed;
- reflection/facts fallback and stale-outcome tests passed;
- real fallback E2E still observed primary -> fallback and merged the fallback model;
- real startup E2E still emitted neither reported warning;
- final suite and typechecks are captured in `final-suite-atomic.log`.

Additional artifacts:

- `model-fallback-atomic.log`
- `skill-startup-atomic.log`
- `final-suite-atomic.log`

## Final reviewer follow-up

The goal reviewer identified a narrower transition gap: attempt N's outcome could be published
before the parent prepared attempt N+1. The final repair moves the transition into the
sentinel-owning supervisor:

- `RunLaunchManifest.nextAttempt` carries the next generation/model/thinking;
- on the exact retryable model miss, the supervisor advances the ledger before writing the current
  outcome;
- a dedicated real-supervisor integration failed first with attempt 1 still in the ledger, then
  passed with `{ attempt: 2, launching: true }` and an attempt-1 outcome.

The quality reviewer also required removal of the last invalid launcher state. When executable,
installed-CLI, and current-entry discovery all fail, the resolver now throws
`Unable to resolve a runnable Senpi launcher` instead of returning a bare Node/Bun interpreter.
That test was captured RED then GREEN.

Final real-surface results after both changes:

- model fallback: primary -> fallback, `merged`, fallback model recorded;
- startup: no missing path warning, no frontend collision, skills path genuinely absent;
- cleanup: both isolation roots removed.

Final artifacts:

- `model-fallback-final2.log`
- `skill-startup-final2.log`
- `final-suite-final2.log`

## CI portability follow-up

The first macOS CI run after launcher hardening exposed a test-only assumption: the runner
integration expected `-p` at argv index zero, but an installed Senpi CLI is correctly represented
as an interpreter command plus a CLI-script prefix before the child arguments.

The assertion now validates the invariant child-argument suffix while dedicated launcher tests
continue to validate the executable/prefix descriptor. Both the normal local environment and a
restricted `PATH=/usr/bin:/bin` installed-CLI branch pass all five runner integration cases, and
omo-senpi typecheck remains clean.

## In-flight reconciliation follow-up

The final goal review identified one remaining interleaving: reconciliation could begin while
attempt N was alive, wait for its outcome, then wake after the supervisor had atomically advanced
the ledger to attempt N+1 with `launching: true` and cleared process identity. Although the stale
attempt-N outcome was correctly rejected, the post-wait path skipped the refreshed `launching`
guard and classified the absent process identity as abandoned.

A deterministic failing-first test now performs that exact state transition inside
`waitForOutcome`. It failed with `abandoned_unknown` before the repair. Reconciliation now reloads
the ledger once after the wait and applies the same decision order as entry:

1. finalize only a matching-generation outcome;
2. preserve a refreshed launch still inside the hard deadline;
3. only then classify process liveness.

Final verification after this production change:

- focused interleaving test: RED (`abandoned_unknown`) -> GREEN;
- reconciliation tests: 9 passed, 0 failed;
- real model fallback and startup-warning E2Es: PASS, isolation roots removed;
- full memory suite: 454 passed, 0 failed, 1325 assertions;
- omo-senpi and senpi-task typechecks: PASS.

Final artifacts:

- `model-fallback-final3.log`
- `skill-startup-final3.log`
- `final-suite-final4.log`

## Why this is enough

The evidence covers both user-reported failure modes at their real boundaries:

1. Senpi executable resolution no longer depends on PATH and was executed successfully.
2. A parent-visible model missing from the clean child now falls through to the next resolved model,
   for both reflection and facts extraction.

Unit tests pin the narrow retry predicate, supervisor integrations exercise real child processes and
git finalization, and the live E2E proves the rebuilt extension performs both attempts and merges the
fallback result in an isolated real Senpi process.

## What was omitted

- No credentials, auth files, provider tokens, environment dumps, or private prompt content were
  copied into this evidence.
- Temporary sandboxes and debug traces are removed during cleanup after the final gate.
