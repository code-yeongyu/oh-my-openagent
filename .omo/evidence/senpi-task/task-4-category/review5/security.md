# Todo 4 Category Resolution - Gate B Review5 Security

recommendation: REJECT
verdict: FAIL
severity: HIGH
worktree: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-category`
branch: `code-yeongyu/senpi-task-w0-category`
base: `27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4`
head: `b4583e46c07d34b9a699d5896803a1d48c74b351`
report: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-category/.omo/evidence/senpi-task/task-4-category/review5/security.md`

## originalIntent

Todo 4 adds category resolution for `senpi-task`: port the builtin category defaults, overlay `omoConfig.categories`, delegate model selection to `@oh-my-opencode/delegate-core`, map the selected `provider/model` through the Senpi registry, and return a typed child spec only for a safe, valid registry model. Registry data and category config are untrusted-ish boundaries, so malformed data must not throw, leak secrets, or produce an invalid resolved model spec.

## desiredOutcome

From the user-visible behavior, `resolveCategory()` should return `resolved` only when the selected model identity is safe and consistent with the registry lookup. Malformed registry outputs should return sanitized `model_unavailable`; secret-like fields and accessor markers must not appear in unavailable result surfaces.

## userOutcomeReview

FAIL. The current HEAD fixes the prior accessor crash class: own throwing `provider`/`id` accessors in `getAvailable()` entries and `find()` results are descriptor-rejected without throwing, and the focused tests pass. However, the resolver still trusts the identity returned by `senpiModelRegistry.find(provider, modelId)` without requiring it to match the selected lookup identity or to be non-empty. A malformed registry can therefore return `resolved` with `spec.provider: ""`, `spec.modelId: ""`, or an unrelated provider/model.

## blockers

1. HIGH - Malformed `find()` results can produce invalid or mismatched resolved specs.

   Evidence: `packages/senpi-task/src/category/resolver.ts:238-240` parses the selected model and calls `senpiModelRegistry.find(parsedModel.provider, parsedModel.modelId)`, then `parseRegistryModel()` only verifies own string data descriptors at `resolver.ts:86-95`. It does not require non-empty strings and does not verify that `foundModel.provider === parsedModel.provider` and `foundModel.modelId === parsedModel.modelId`. The spec then copies the found identity into `ResolvedChildSpec` at `resolver.ts:255-258`.

   Direct probe at current HEAD:

   - `find()` returning `{ provider: "", id: "" }` produced `kind: "resolved"` with `spec.provider: ""` and `spec.modelId: ""`.
   - `find()` returning `{ provider: "evil", id: "other" }` produced `kind: "resolved"` while `modelSelection.selectedModel` remained `openai/gpt-5.4-mini`.
   - `find()` returning `{ provider: "openai", id: "" }` produced `kind: "resolved"` with an empty model id.

   Why blocking: this violates the requested security criterion that malformed registry objects must not produce an invalid resolved model spec. It also creates an identity-confusion path between the selected model and the child spec actually returned to future Senpi task spawning.

## non_blocking_checks_passed

- `bun test packages/senpi-task/src/category/resolve-category-boundary.test.ts`: 8 pass, 0 fail.
- `bun test packages/senpi-task/src/category/resolve-category.test.ts`: 10 pass, 0 fail.
- `bun test packages/senpi-task --bail`: 47 pass, 0 fail, 1 snapshot.
- Direct 19-case adversarial probe: PASS for legal `headers`, own throwing `provider`/`id` accessors in both availability and find paths, own secret-like fields (`password`, `accessToken`, `apiKey`, `authorization`, `secret`, `token`, `private-key`, `client.secret`, `bearer_token`), inherited identity, and prototype-shaped categories.
- `bun run packages/senpi-task/scripts/manual-category-qa.ts`: exit 0, including accessor, secret-field, inherited identity, non-array availability, and prototype category scenarios.
- Correct TypeScript no-excuse guard: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts` -> `No violations in 13 file(s).`
- `git diff --check 27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4...HEAD -- packages/senpi-task/src/category packages/senpi-task/src/index.ts packages/senpi-task/scripts/manual-category-qa.ts`: exit 0.
- Side-effect/import scan over scoped source found no new file, network, process, env, dynamic import, eval, or child-process surface. The scan exits 1 because there were no matches.
- Credential-shaped scan found no real credential-like values. One old evidence false positive was `sk-package-regression` inside the string `senpi-task-package-regression`, not a secret.

## skill_and_slop_review

- Loaded and applied `programming` plus TypeScript criteria: descriptor-based model identity parsing is a good boundary shape, but the boundary remains incomplete because it accepts empty and mismatched identity strings after `find()`.
- Loaded and applied `remove-ai-slops`: the accessor tests are behavior-oriented, not tautological or deletion-only, and the production change is not unnecessary extraction. The unresolved gap is missing adversarial coverage for mismatched/empty `find()` identities, not over-testing.
- Consulted the security diff scan hard rules and kept the review anchored to the changed category resolver, tests, scripts, and evidence.
- Existing reports do include skill-perspective/slop coverage (`review4-code-quality.md`, `review4-goal-constraints.md`, `repair5-accessor-boundary/report.md`), but those reports do not cover this malformed `find()` identity class.

## checked_artifact_paths

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
- `.omo/evidence/senpi-task/task-4-category/review4-security.md`
- `.omo/evidence/senpi-task/task-4-category/review4-code-quality.md`
- `.omo/evidence/senpi-task/task-4-category/review4-goal-constraints.md`
- `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/report.md`
- `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/postclaim-verification/report.md`
- `.omo/evidence/senpi-task/task-4-category/review5/qa/`

## exact_evidence_gaps

- No unit test or manual QA case verifies that `find()` returning a different own `{ provider, id }` than the requested lookup is rejected.
- No unit test or manual QA case verifies that `find()` returning own empty-string `provider` or `id` is rejected.
- Existing security/accessor evidence proves no-throw and no secret leak for accessor/secret/prototype classes, but not resolved spec identity integrity.

## residual_risk

- `ResolvedChildSpec.model` intentionally preserves the raw registry object for valid models. That is acceptable for legal metadata such as top-level `headers`, but it increases the importance of a strict identity parser at the registry boundary.
- `resolver.ts` is exactly 250 pure LOC in my check. This is not over the hard ceiling, but future behavior edits should split before adding logic.

Final verdict: FAIL
