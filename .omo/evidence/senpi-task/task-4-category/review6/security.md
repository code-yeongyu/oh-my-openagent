# Todo 4 Category Resolution - Review6 Security Gate

recommendation: APPROVE
verdict: PASS
severity: NONE
worktree: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-category`
branch: `code-yeongyu/senpi-task-w0-category`
base: `27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4`
head: `70c148a2fa84d1a531903a34904f9a60a4d23f0f`
report: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-category/.omo/evidence/senpi-task/task-4-category/review6/security.md`

## originalIntent

Todo 4 adds safe category resolution for `senpi-task`: port the builtin category defaults, overlay `omoConfig.categories`, delegate model selection to `@oh-my-opencode/delegate-core`, map the selected `provider/model` through the Senpi model registry, and return a typed child spec only when the registry result is safe and identity-consistent. Malformed registry and config-shaped data must return sanitized typed failures rather than throwing, leaking secrets, or producing invalid resolved child specs.

## desiredOutcome

`resolveCategory()` should return `resolved` only for the exact selected registry model identity. Malformed `senpiModelRegistry.find(provider, id)` results, including empty identity fields and provider/id mismatches, must return sanitized `model_unavailable`. Existing boundaries must remain intact: legal `headers` metadata is accepted, own secret-like fields are rejected without leakage, inherited provider/id is rejected without leakage, own throwing accessors do not throw, non-array availability and malformed truthy `find()` results cannot produce invalid specs, and no new command/path/network/auth or runtime `omo-opencode` import surface appears.

## userOutcomeReview

PASS. The prior HIGH blocker is closed. `parseRegistryModel()` now rejects empty `provider`/`id` and, when called for `find()` results, requires exact equality with the selected parsed model identity (`resolver.ts:81`, `resolver.ts:90`). `resolveCategory()` passes the selected `{ provider, modelId }` into that parser for `senpiModelRegistry.find(...)` and falls back to sanitized `model_unavailable` when parsing fails (`resolver.ts:236`, `resolver.ts:237`, `resolver.ts:241`).

Fresh direct probe of the three required cases returned only:

- `{ provider: "", id: "" }` -> `kind: "model_unavailable"`, `attemptedModel: "openai/gpt-5.4-mini"`.
- `{ provider: "evil", id: "other" }` -> `kind: "model_unavailable"`, no `evil`/`other` in serialized output.
- `{ provider: "openai", id: "" }` -> `kind: "model_unavailable"`, `attemptedModel: "openai/gpt-5.4-mini"`.

## blockers

None.

## verification

- `bun test packages/senpi-task/src/category/resolve-category-boundary.test.ts`: PASS, 9 tests / 69 expects. Covers legal headers, malformed registry entry, throwing available accessor, malformed truthy `find`, throwing `find` accessor, empty/mismatched `find` identity, inherited identity, non-array availability, and prototype-shaped category names.
- Direct inline malformed-identity probe: PASS, all three required `find()` outputs returned sanitized `model_unavailable`; mismatched identity strings did not leak.
- `bun run packages/senpi-task/scripts/manual-category-qa.ts`: PASS. Output shows `identityFind` has three `model_unavailable` results and previous `secretFind`, `throwingFind`, `inheritedIdentity`, and `nonArrayAvailable` cases remain sanitized.
- `bun test packages/senpi-task/src/category`: PASS, 19 tests / 1 snapshot.
- `bun test packages/senpi-task --bail`: PASS, 48 tests / 1 snapshot.
- `bun run typecheck`: PASS.
- `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts`: PASS, `No violations in 13 file(s).`
- `git diff --check` over base...HEAD scoped category/manual files: PASS.

## staticSecurityReview

- Runtime `omo-opencode` import guard: `rg` over scoped TypeScript source returned no executable import/export/require matches.
- Command/path/network/auth surface guard: `rg` for `child_process`, `spawn`, `exec`, `fetch`, `WebSocket`, `process.env`, `Bun.file`, `Bun.write`, `node:fs`, and URL literals returned no matches in scoped TypeScript source.
- Raw credential-pattern guard: `rg` for common OpenAI/GitHub/Slack/AWS/private-key credential shapes returned no matches.
- Broader text scan matches only test fixture labels such as `password: "hidden"` and prompt prose in category text; these are deliberate adversarial fixtures/content, not leaked secrets.

## fileSizeReview

Pure LOC check used non-blank, non-`//` lines. No scoped TypeScript file exceeds 250 pure LOC.

- `packages/senpi-task/src/category/resolver.ts`: 248 pure LOC.
- `packages/senpi-task/src/category/resolve-category.test.ts`: 191 pure LOC.
- `packages/senpi-task/src/category/resolve-category-boundary.test.ts`: 187 pure LOC.
- `packages/senpi-task/scripts/manual-category-qa.ts`: 227 pure LOC.
- All other scoped category/manual TypeScript files are below 250 pure LOC.

Note: `.omo/evidence/senpi-task/task-4-category/review6/qa.md` reports FAIL on LOC, but its command used physical `wc -l`, not the requested pure LOC metric, and therefore flags `resolver.ts` physical lines instead of the expected 248 pure LOC. I do not treat that QA report's LOC failure as a security blocker for this review.

## skillAndSlopReview

Loaded and applied `programming` and TypeScript criteria plus `remove-ai-slops` criteria directly.

- Production repair is minimal and at the boundary: the optional `expected` identity on `parseRegistryModel()` prevents identity confusion without adding a new abstraction layer. The `parseAvailableModels()` call site uses a lambda so `Array.map` does not accidentally pass the array index as the optional expected identity.
- No `any`, `as unknown`, `@ts-ignore`, `@ts-expect-error`, non-null assertions, empty catch, or catch-and-swallow patterns were found in scoped TypeScript source.
- Added tests are adversarial and behavior-oriented. They are not deletion-only, tautological, or implementation-mirroring: they fail on the old resolved-empty/mismatched result and assert the observable sanitized result surface.
- No unresolved AI-slop security issue found. No unnecessary production extraction, parsing layer, normalization pass, or speculative abstraction was introduced by repair6.
- Report coverage note: prior `review5/security.md` and `review5/context.md` explicitly include programming/remove-ai-slops perspectives. Repair6's own report focuses on red/green/evidence rather than a separate slop section; this review therefore performed the direct slop/security pass rather than relying on that report.

## checkedArtifactPaths

- `packages/senpi-task/src/category/resolver.ts`
- `packages/senpi-task/src/category/types.ts`
- `packages/senpi-task/src/category/index.ts`
- `packages/senpi-task/src/category/builtins.ts`
- `packages/senpi-task/src/category/fallback-chains.ts`
- `packages/senpi-task/src/category/openai-categories.ts`
- `packages/senpi-task/src/category/google-categories.ts`
- `packages/senpi-task/src/category/anthropic-categories.ts`
- `packages/senpi-task/src/category/kimi-categories.ts`
- `packages/senpi-task/src/category/resolve-category.test.ts`
- `packages/senpi-task/src/category/resolve-category-boundary.test.ts`
- `packages/senpi-task/src/category/__snapshots__/resolve-category.test.ts.snap`
- `packages/senpi-task/src/index.ts`
- `packages/senpi-task/scripts/manual-category-qa.ts`
- `.omo/evidence/senpi-task/task-4-category/review5/security.md`
- `.omo/evidence/senpi-task/task-4-category/review5/context.md`
- `.omo/evidence/senpi-task/task-4-category/review6/qa.md`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/report.md`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/red-focused-boundary.log`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/green-focused-boundary.log`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/manual-category-qa.log`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/no-excuse.log`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/loc-check.log`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/static-no-omo-opencode-import.log`
- `.omo/evidence/senpi-task/task-4-category/repair6-registry-identity/CLEANUP-RECEIPT.md`

## exactEvidenceGaps

No blocking security evidence gaps remain for the review6 focus.

Non-blocking artifact issue: `review6/qa.md` contains an incorrect LOC failure because it measured physical lines rather than pure LOC. Fresh pure-LOC review confirms the expected resolver count is 248 and no scoped file is over 250 pure LOC.

## residualRisk

`ResolvedChildSpec.model` intentionally preserves the raw registry object for valid exact identities so legal metadata such as `headers` survives. That remains acceptable under the requested boundary because top-level own secret-like fields are rejected before a model can resolve.

Final verdict: PASS
