# Evidence: Issue #6862 - Multi-file prompt_append (string | string[])

Date: 2026-08-24
Branch: issue/6862-multifile-prompt-append (worktree /home/viprix/projects/oom-wt-6862, base dev @8833800ae)

## WHAT WAS TESTED

Commands (bun 1.3.14, repo worktree):

1. `bun test tests/omo-config-category-drift.test.ts tests/omo-schema-freshness.test.ts`
   - Proves: omo-config-core and omo-opencode category schemas stay field-parity after the
     `prompt_append` union change; regenerated `assets/omo.schema.json` matches the committed
     artifact; the docs/reference/omo-json.md example still validates against OmoConfigSchema.
2. `bun test packages/omo-config-core/src/schema/config-schema.test.ts packages/omo-opencode/src/agents/agent-identity.test.ts packages/omo-opencode/src/agents/builtin-agents/resolve-file-uri.test.ts packages/omo-opencode/src/config/schema.test.ts packages/omo-opencode/src/config/schema/agent-overrides.test.ts packages/omo-opencode/src/tools/delegate-task/tools.test.ts packages/senpi-task/src/category/resolve-category.test.ts`
   - The seven failing-first regression suites (salvaged from the crashed prior agent session,
     which had produced test-only changes with no implementation). They cover:
     array-form schema acceptance + order preservation, rejection of non-string entries and
     non-string/non-array values, resolvePromptAppendSources single-string parity / per-entry
     file:// resolution in array order / mixed inline+file entries / empty-array -> undefined /
     per-entry home-relative expansion inside allowed home subdirs, mergeAgentConfig array
     composition ("BASE\nFIRST\n\nSECOND") and string-vs-single-entry-array equivalence,
     delegate-task category promptAppend ordering for builtin + custom categories, and senpi-task
     overlay append ordering.
3. `bun test packages/omo-opencode/src/agents/sisyphus-junior/index.test.ts packages/omo-opencode/src/plugin-config`
   and `bun test packages/omo-opencode/src/plugin-handlers/agent-config-handler.test.ts packages/omo-opencode/src/plugin-handlers/agent-config-handler-agents-skills.test.ts`
   - Adjacent suites for the sisyphus-junior pre-resolve path and agent config assembly.
4. `bun test packages/senpi-task`
   - Full senpi-task package gate (resolver.ts edit).
5. `bun run typecheck` (tsgo --noEmit root + script + all 30 workspace package configs)
6. `bun run build:schema && bun run build:omo-schema` before re-running guard (1).

## WHAT WAS OBSERVED

1. Guard suites: 4 pass / 0 fail.
2. Salvaged regression suites: 275 pass / 0 fail (631 expect calls).
3. Adjacent suites: 53 pass / 0 fail; plugin-handlers: 33 pass / 0 fail.
4. senpi-task full: 1743 pass / 1 skip / 0 fail.
5. typecheck: completed with no errors across root, script, and every workspace package.
6. Schema regeneration diffed only structural anyOf/items expansion around prompt_append
   (verified by filtering the diff: zero unrelated description/enum/default/required churn).
7. Failing-first proof: at session start `git status --short` showed exactly the seven modified
   *.test.ts files and NO production-code changes; the new tests referenced a then-nonexistent
   `resolvePromptAppendSources` export and array-form schema behavior, so they could not pass
   before this change landed.

## WHY IT IS ENOUGH

- Every acceptance criterion of issue #6862 has a co-located given/when/then assertion that was
  red before the implementation existed and is green now: string|string[] acceptance in both
  agents and categories schemas, deterministic array-index ordering, mixed inline/file:// arrays,
  per-entry ~ expansion within the existing allowed-path security bounds, and backward-compatible
  single-string behavior (including exact legacy semantics for empty-string values, which skip
  appending entirely rather than emitting a bare separator).
- The drift guard plus regenerated artifacts keep the three schema surfaces (omo-config-core,
  omo-opencode, generated JSON assets) in lockstep, so editor autocomplete ships the new union.
- Full-package senpi-task suite and repo-wide typecheck bound the blast radius across the four
  packages touched (omo-config-core, omo-opencode, senpi-task, docs/assets).
- Remaining risk: live-harness (real opencode process) QA was not driven; see OMITTED.

## WHAT WAS OMITTED

- Live opencode/codex/senpi harness drive (opencode-qa / codex-qa / senpi-qa skills): this change
  is config-schema + pure resolution logic exercised through the hermetic unit gates above; no
  lifecycle hook, tool registration surface, or DB path changed. No real ~/.codex, ~/.senpi, or
  opencode.db was touched (all verification ran as scoped bun test/typecheck processes).
- PR #6339's conditional model-keyword append fields (prompt_append_include_model_keywords etc.)
  remain out of scope; this implements the issue's core string|string[] + array-index ordering.
- No secrets, tokens, or env dumps were produced or recorded by any command above.
