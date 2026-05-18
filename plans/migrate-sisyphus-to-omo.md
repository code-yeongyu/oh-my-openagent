# Migrate Legacy Workspace State To .omo

## Goal

Move project-scoped OMO state from `.sisyphus` to `.omo`, while preserving existing legacy state by copying `.sisyphus` into `.omo` on plugin startup when `.sisyphus` is detected.

## Task Graph

1. Add shared legacy workspace migration helper.
   - Depends on: none.
   - Acceptance: copies nested files from `.sisyphus` into `.omo`, creates missing directories, does not overwrite existing `.omo` files, and returns whether anything migrated.

2. Invoke migration at plugin startup.
   - Depends on: task 1.
   - Acceptance: startup calls the helper before managers/tools/hooks are created.

3. Switch runtime state constants to `.omo`.
   - Depends on: task 1.
   - Acceptance: Boulder and run-continuation writes land under `.omo`.

4. Switch guardrails and prompt-facing workspace paths to `.omo`.
   - Depends on: task 3.
   - Acceptance: Prometheus, Atlas, notepad, write-existing guard, and plan extraction surfaces point at `.omo`.

5. Update docs, ignore rules, and generated schema.
   - Depends on: tasks 3-4.
   - Acceptance: user-facing storage docs and schema examples no longer advertise `.sisyphus` for active workspace state.

6. Verify and ship.
   - Depends on: tasks 1-5.
   - Acceptance: focused tests, typecheck, full test suite, build, manual QA, CI, GPT-5.2 review, and Cubic all pass before merge.

## Dependency Matrix

| Task | Blocks | Verification |
| --- | --- | --- |
| Migration helper | Startup invocation, path switch | `bun test src/shared/legacy-workspace-migration.test.ts` |
| Startup invocation | Manual QA | `bun test src/testing/create-plugin-module.test.ts` or equivalent startup test |
| Runtime constants | Hook and CLI behavior | Boulder/run-continuation focused tests |
| Guardrails/prompts | Agent workflow behavior | Prometheus/Atlas/write guard focused tests |
| Docs/schema | PR review and release docs | `bun run build:schema`, `rg "\\.sisyphus"` audit |
| Verification | Merge | local gates, PR CI, reviews |

## QA Scenarios

- Happy path: project has `.sisyphus/plans/a.md` and no `.omo`; startup creates `.omo/plans/a.md` with same content.
- Existing target: project has `.sisyphus/plans/a.md` and `.omo/plans/a.md`; migration leaves `.omo/plans/a.md` unchanged.
- Mixed tree: project has `.sisyphus/plans/a.md` and `.omo/notepads/note.md`; migration copies only missing legacy files.
- Runtime write: `writeBoulderState()` creates `.omo/boulder.json`.
- Continuation marker: `setContinuationMarkerSource()` writes `.omo/run-continuation/<session>.json`.
- Guardrail: Prometheus may write `.omo/plans/*.md` and is blocked outside `.omo`.
- Adjacent compatibility: rules injector still discovers legacy `.sisyphus/rules` alongside `.omo/rules` if kept for transition.

## Commit Strategy

1. `feat(workspace): migrate legacy sisyphus state to omo`
   - Migration helper, startup invocation, runtime constants, and direct tests.

2. `docs(workspace): document omo workspace paths`
   - Docs, `.gitignore`, schema output, and prompt/docs wording updates if separated cleanly.
