# Fix #6869: task() subagents ignore configured primary model when fallbacks present

**WHAT WAS TESTED:** delegate-core's resolveModelForDelegateTask demoted a
user-configured primary model whenever fallback_models were present and
fuzzyMatchModel returned null for the primary. The fix: an explicit user
primary always wins; the fallback-promotion branch engages only when the
primary is verifiably absent from the available set (exact-match check),
not when fuzzy matching is merely inconclusive. Also: the agent
delegate-task path now reads the schema-valid `models` array (primary =
models[0], fallbacks = models.slice(1)), matching the category-resolver
path, since `models` is the documented replacement for `fallback_models`.

**WHAT WAS OBSERVED:**
1. `bun test packages/delegate-core/src/model-selection.test.ts` -> 11 pass /
   0 fail. New tests: (a) primary present in available set + fallbacks present
   -> primary kept; (b) primary present but fuzzy-inconclusive (provider alias
   mismatch) + fallbacks present -> explicit primary still wins.
2. `bun test packages/delegate-core/` -> 12 pass / 0 fail.
3. `bun test packages/omo-opencode/src/tools/delegate-task/` -> 483 pass /
   0 fail (models array wiring does not regress category/agent resolution).
4. `bun run typecheck` -> exit 0; `bun run build` -> exit 0.

**WHY IT IS ENOUGH:** the two new tests pin the exact regression from the
issue's reproduction table (config with model + fallback_models must keep the
primary). The delegate-task suite proves the models-array wiring is safe.

**WHAT WAS OMITTED:** a live opencode run with a real connected-provider
cache (needs a session); the logic is fully covered by the deterministic unit
tests including the alias-mismatch case the reporter's table implies.
