# Repair6 Registry Identity Evidence

## Root Cause

`resolveCategory()` parsed `senpiModelRegistry.find(provider, id)` results as long as `provider` and `id` were own string data properties. It did not require the returned identity to be non-empty or to match the requested lookup identity, so malformed registry data could produce a `resolved` child spec with empty or mismatched `spec.provider` / `spec.modelId`.

## Red Evidence

Focused test added before the fix:

- Scenario: `find()` returns `{ provider: "", id: "" }`, `{ provider: "evil", id: "other" }`, and `{ provider: "openai", id: "" }`.
- Invocation: `bun test packages/senpi-task/src/category/resolve-category-boundary.test.ts`
- Observable: exit `1`; failure showed a `resolved` result with empty `spec.modelId`.
- Artifacts: `red-focused-boundary.log`, `red-focused-boundary.exit`

## Fix

- `packages/senpi-task/src/category/resolver.ts`: `parseRegistryModel()` now rejects empty own string identities and, for `find()` results, requires exact equality with the requested `{ provider, modelId }`.
- `packages/senpi-task/src/category/resolve-category-boundary.test.ts`: added behavioral coverage for all three malformed `find()` identity cases.
- `packages/senpi-task/scripts/manual-category-qa.ts`: added the same malformed identity cases to the real manual QA script.

The change keeps model ordering in `@oh-my-opencode/delegate-core`; no local seven-step model-order implementation was added.

## Verification

| Check | Invocation | Exit | Artifact |
|---|---|---:|---|
| Before status | `git status --short --untracked-files=all` | 0 | `status-before.log` |
| Red focused test | `bun test packages/senpi-task/src/category/resolve-category-boundary.test.ts` | 1 | `red-focused-boundary.log` |
| Green focused test | `bun test packages/senpi-task/src/category/resolve-category-boundary.test.ts` | 0 | `green-focused-boundary.log` |
| Category suite | `bun test packages/senpi-task/src/category` | 0 | `green-category-dir.log` |
| Package suite | `bun test packages/senpi-task --bail` | 0 | `green-senpi-task-bail.log` |
| Typecheck | `bun run typecheck` | 0 | `typecheck.log` |
| Manual QA | `bun run packages/senpi-task/scripts/manual-category-qa.ts` | 0 | `manual-category-qa.log` |
| No-excuse TS guard | `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts` | 0 | `no-excuse.log` |
| LOC ceiling | touched TS file LOC check | 0 | `loc-check.log` |
| No runtime omo-opencode import | import-statement `rg` guard | 0 | `static-no-omo-opencode-import.log` |
| No local model-order rewrite | model-order `rg` guard | 0 | `static-no-local-seven-step-order.log` |
| Zero-byte artifact scan | `find ... -type f -size 0 -print` | 0 | `zero-byte-check.log` |
| Cleanup scan | debug ports/processes + git status | 0 | `cleanup-check.log` |
| After verification status | `git status --short --untracked-files=all` | 0 | `status-after-verification.log` |

LOC observable from `loc-check.log`:

- `packages/senpi-task/src/category/resolver.ts`: 248 pure LOC
- `packages/senpi-task/src/category/resolve-category-boundary.test.ts`: 187 pure LOC
- `packages/senpi-task/scripts/manual-category-qa.ts`: 227 pure LOC

## Cleanup

No tmux sessions, servers, debug listeners, or temp fixtures were created by this repair. Evidence artifacts are intentionally kept under this directory for review.

## Residual Risks

- `ResolvedChildSpec.model` still preserves the raw registry model for valid identities, as earlier behavior allowed legal metadata such as headers.
- The static model-order guard is a source scan proving this repair did not add a local order implementation; delegate-core remains the runtime source of model selection truth.
