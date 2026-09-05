# PR #7254 source-only reconstruction: loader 叶修剪适配 a66022557 控制流

Branch `wt-7254b` (worktree `.local-ignore/wt-7254b`), base `origin/dev` @ `48c7dc21c`. NOT pushed.
Maintainer approved the approach on issue #7670 ("Happy to take a PR for this if you've got one ready to rebase onto current dev").

## WHAT WAS TESTED

- `bun test packages/omo-config-core/` — full core suite including the new `loader-prune.test.ts` and dev's `unknown-keys.test.ts` (proto-pollution guard, unknown-key stripping).
- `bun test packages/omo-opencode/src/config/schema/core-schema-parity.test.ts` — key-drift guard cherry-picked from 2c217e312.
- `bun run typecheck` (tsgo root + script + all 28 workspace packages).

Behavior proven: (1) unknown keys inside `agents.*` leaves are still stripped and the leaf survives (dev a66022557 semantics preserved); (2) a wrong-typed value in an `agents.*`/`categories.*` leaf prunes exactly that leaf, keeps healthy siblings, and emits one `validation` diagnostic naming the dropped leaf; (3) any non-record-leaf failure (e.g. `task.default_concurrency: "not-a-number"`) still rejects the whole layer fail-closed; (4) the prototype-pollution guard runs before any pruning and stays fail-closed.

## WHAT WAS OBSERVED

- `bun test packages/omo-config-core/`: 213 pass / 0 fail / 551 expect() across 35 files.
- `bun test packages/omo-opencode/src/config/schema/core-schema-parity.test.ts`: 3 pass / 0 fail / 24 expect().
- `bun run typecheck`: exit 0, no errors.
- Commits (oldest first): `76c36f235` test RED (ec4a1db1d), `33e874f65` schema keys GREEN (12a701ee3, 生成的 assets/omo.schema.json 已剔除), `465ede172` loader 叶修剪适配, `e283ba6a9` 键位漂移守卫 (2c217e312), `d9d5ede11` QA 证据 (ed4f8b29f)。

Adaptation decisions in `465ede172` (original 90bcbfd21 targeted the pre-a66022557 control flow):

1. Gate order per spec: prototype-pollution guard (fail-closed, never pruned past) → unknown-key stripping (unchanged dev behavior) → record-leaf pruning only when every remaining issue targets an `agents.*`/`categories.*` leaf (`hasOnlyRecordLeafIssues`).
2. Pruning moved from the merged-document level (original PR) to the per-layer `readConfigSource` path, because a66022557 validates and partially-recovers per layer. Layer-level totality on bound exhaustion: whole layer rejected (fail-closed), matching dev's reject semantics.
3. `readConfigSource` now returns `diagnostics: readonly OmoConfigDiagnostic[]` (was a single optional `diagnostic`) so each pruned leaf emits its own diagnostic; caller folds the array.
4. `prune-invalid-leaves.ts` ported from 90bcbfd21 with only doc-comment changes (bound exhaustion now means "caller rejects the layer" instead of "fall back to merged defaults"); logic verbatim.
5. Test fixture `agents.oracle = { model: "kimi-k3", bogus_key: 1 }` rewritten: on dev the unknown key is stripped and oracle SURVIVES (asserted); new wrong-typed-value fixtures (`model: 123`) exercise the pruning gate for agents, its categories twin, and the mixed reject case.

## WHY IT IS ENOUGH

The adapted suite covers every gate of the new failure path with both positive and boundary cases, and dev's own `unknown-keys.test.ts` (4 tests, still green) independently pins the pre-existing stripping and proto-pollution behavior my change must not alter — a regression in either would fail the run. The drift guard proves the core/adapter schema key surfaces still agree after the schema-keys commit. Typecheck proves the internal `readConfigSource` signature change (single diagnostic → array) has no untyped consumers.

## WHAT WAS OMITTED

- `assets/omo.schema.json` (generated artifact; excluded from `33e874f65`, maintainer's stated rejection reason for the original PR). Regeneration is the build pipeline's job.
- No live OpenCode/Codex/Senpi harness QA: the change is confined to the harness-neutral `omo-config-core` loader plus one schema-parity test; the loader's behavior is exercised end-to-end through `loadOmoConfig` in tests with injected filesystems. No secrets, env dumps, or tokens appear in this evidence.
- The stale worktree `.local-ignore/wt-7254` from the first reconstruction attempt is intentionally untouched (frozen conflict state, superseded by this worktree).

## FOLLOW-UP (2026-09-03): nested-__proto__ guard gap found and fixed

**Discovery.** While pinning the review's second invariant (pollution guard before pruning), a regression fixture failed against the then-current code: hostile input nested under `agents.*` was pruned-and-ACCEPTED instead of rejected fail-closed. Probe evidence (jsonc-parser + zod): `__proto__` is written through the prototype (own keys of the hostile leaf exclude it), and zod surfaces the inherited payload key as `unrecognized_keys` ONLY at the layer root — nested hostile input yields issues only at e.g. `["agents","evil","model"]` (`invalid_type`), so the guard's `unrecognized.length > 0` precondition never held at depth. This violated the guard's own documented fail-closed policy and the maintainer's issue #7670 condition that the pollution guard is the first gate.

**Fix.** `1e88c7d42` — one-line semantic change at the guard call site (`loader.ts:199`): drop the `unrecognized.length > 0 &&` precondition so `hasUnsafeUnrecognizedKey`/`hasTamperedPrototype` runs unconditionally on the validation-failure path; doc comment aligned ("at ANY depth") with the zod root-only asymmetry explained. No other behavior changes: root-level rejection shape and diagnostic kind unchanged, clean unknown-key stripping unaffected (clean trees have untampered prototypes).

**Sensitivity evidence.** Pre-fix, the fixture failed (`loader-prune.test.ts` expected every source not-loaded, got a loaded layer); post-fix it passes. A gate-removal probe on the record-leaf gate (fixture A) was also performed earlier: with the gate patched out the fixture failed, then loader.ts was restored byte-identical (verified `git diff` CLEAN).

**Flagged for the maintainer (PR description).** (1) Behavior change: nested hostile input under `agents.*`/`categories.*` is now rejected at any depth on the validation-failure path — deliberate, restores the documented policy. (2) Residual, PRE-EXISTING on vanilla dev and intentionally out of scope here: hostile input with NO other validation issues (e.g. `{"agents":{"evil":{"__proto__":{"x":1}}}}`, empty own keys) still LOADS — zero issues means the failure-path guard never runs; only the merge-time unsafe-key sanitization discards the payload (probed: `evil: {}`, no diagnostic). Closing that would require success-path tamper scanning, a separate behavior change. (3) Commits: `1e88c7d42` fix, `ef407192a` test (fixture B, `loader-prune.test.ts:194`).
