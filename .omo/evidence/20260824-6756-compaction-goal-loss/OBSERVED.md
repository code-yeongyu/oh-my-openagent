# WHAT WAS OBSERVED

## Failing-first (RED) - captured before any implementation edit

- `red-pi-goal.log`: `bun test packages/pi-goal/test/store.test.ts packages/pi-goal/test/prompt.test.ts`
  -> 15 pass / 8 fail. New tests failing exactly on the missing contract:
  - store: originalObjective/deliverables undefined at creation, not preserved by updates, not reset
    on explicit objective replacement.
  - prompts: no `<session-goal>` anchor in continuation/budget-limited prompts.
  - (v1 backward-compat guard passed pre-change and must keep passing; unknown fields were already
    ignored by the v1 parser.)
- `red-omo-goal.log`: `bun test packages/omo-opencode/src/hooks/goal/` -> 49 pass / 6 fail:
  - store: createGoal does not initialize originalObjective/deliverables; updateGoal does not preserve.
  - prompt: no `<session-goal>` anchor in continuation/resume prompts.
  - index: `session.compacted` produced ZERO dispatched prompts (event was ignored) - the exact
    compaction-goal-loss regression.

## After fix (GREEN)

- `green-pi-goal.log`: 64 pass / 0 fail (149 expect calls, 9 files).
- `green-omo-goal.log`: 56 pass / 0 fail (106 expect calls, 7 files).
- Compaction regression now observes: exactly one `promptAsync` capture per `session.compacted`
  event for an active goal; part text contains `<session-goal>`, `<original_objective>` content,
  current objective, both derived deliverables; `part.synthetic === true`;
  `isSyntheticOrInternalTextPart(part) === true`; `hasInternalNoReplyMarker(part.text) === true`.
  Sessions without a goal and completed goals dispatch nothing.
- Explicit-redirect scenario observes the anchor carrying the NEW original after a second setGoal
  (controller.setGoal is clear+create = explicit reset, matching the issue's redirect rule).

## Typecheck

- `typecheck-pi-goal.log`: tsgo --noEmit exit 0.
- `typecheck-omo-opencode.log`: tsgo --noEmit exit 0 (whole adapter package).

## Live driver

- `pi-goal-driver-self-test.log`: `{"result":"PASS","mode":"self-test"}`.

## Environment note (pre-existing, documented per task brief)

- `bun install` fails in the prepare step at
  `packages/omo-codex/plugin/scripts/materialize-shared-upstreams.mjs` with
  "git submodule init failed ... Unable to find current revision in submodule path
  packages/shared-skills/upstreams/open-design". This is the task-brief-documented pre-existing
  submodule fetch failure; node_modules installed and all scoped gates above ran successfully.
