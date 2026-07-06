# Todo 4 Category Resolver Repair 5 - Accessor Boundary

## Root Cause

`resolveCategory()` accepted registry model objects by checking own `provider` and `id` keys and then reading `model.provider` / `model.id`. Own accessor descriptors satisfy the own-key check, so malformed registry entries could throw from getters during `getAvailable()` parsing or `find()` result parsing.

The fix parses registry identity through own property descriptors only. `provider` and `id` must be own data descriptors with string values; accessor descriptors are malformed and return typed `model_unavailable`. Secret-like own fields still reject, inherited identity still rejects, and legal `headers` remain allowed.

## Red Proof

- Scenario: `getAvailable()` returns an own throwing `provider` accessor with own data `id`.
- Invocation: `bun test packages/senpi-task/src/category`.
- Observable: failed with `expect(resolver).not.toThrow()` and marker `hidden available accessor marker`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/red-accessor-boundary-tests.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/red-accessor-boundary-tests.exit` = `1`.

- Scenario: `find()` returns an own throwing `provider` accessor while availability contains a valid model.
- Invocation: `bun test packages/senpi-task/src/category`.
- Observable: failed with `expect(resolver).not.toThrow()` and marker `hidden find accessor marker`.
- Artifact: same red log and exit file above.

## Green Proof

- Scenario: category resolver unit boundary suite, including legal headers, secret-like keys, inherited identity, non-array availability, prototype category names, and both accessor probes.
- Invocation: `bun test packages/senpi-task/src/category`.
- Observable: `18 pass, 0 fail`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/01-category-tests.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/01-category-tests.exit` = `0`.

- Scenario: full `packages/senpi-task` package test gate.
- Invocation: `bun test packages/senpi-task --bail`.
- Observable: `47 pass, 0 fail`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/02-senpi-task-bail.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/02-senpi-task-bail.exit` = `0`.

- Scenario: repository TypeScript diagnostics.
- Invocation: `bun run typecheck`.
- Observable: root, script, package, and `packages/senpi-task/tsconfig.json` checks completed with exit `0`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/03-typecheck.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/03-typecheck.exit` = `0`.

## Manual QA

- Scenario: executable category QA script drives happy, disabled, unavailable, fallback, system-default, legal-header, malformed, secret-field, inherited-identity, non-array availability, prototype category, and new throwing-accessor paths.
- Invocation: `bun run packages/senpi-task/scripts/manual-category-qa.ts`.
- Observable: JSON output includes `throwingAvailable.kind: "model_unavailable"` with empty `availableModels`, and `throwingFind.kind: "model_unavailable"` with valid `availableModels: ["openai/gpt-5.4-mini"]`; hidden accessor markers are not serialized.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/04-manual-category-qa.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/04-manual-category-qa.exit` = `0`.

## Static And Hygiene Checks

- Invocation: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts`.
- Observable: `No violations in 13 file(s).`
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/05-no-excuse.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/05-no-excuse.exit` = `0`.

- Invocation: pure LOC check over scoped TypeScript files.
- Observable: all files are `<=250` pure LOC; `resolver.ts` is exactly `250`.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/06-loc-check.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/06-loc-check.exit` = `0`.

- Invocation: `git diff --check 27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4...HEAD -- packages/senpi-task/src/category packages/senpi-task/src/index.ts packages/senpi-task/scripts/manual-category-qa.ts`.
- Observable: no whitespace errors.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/07-diff-check.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/07-diff-check.exit` = `0`.

- Invocation: zero-byte artifact check under this repair evidence directory.
- Observable: no zero-byte artifacts found.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/08-zero-byte-check.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/08-zero-byte-check.exit` = `0`.

- Invocation: scoped sensitive scan over product/test/manual/evidence diff.
- Observable: matches are expected fixture words only (`password`, `accessToken`, `privateToken`, `hidden`, and secret-like deny-list names); no credential-shaped tokens found.
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/09-sensitive-scan.log`, exit `.omo/evidence/senpi-task/task-4-category/repair5-accessor-boundary/09-sensitive-scan.exit` = `0`.

## Cleanup

No temporary files remain in the evidence directory. The first failed zero-byte implementation briefly self-reported `.zero-byte.tmp`; it was removed and the check was rerun with scratch space outside the evidence directory.

## Residual Risk

`ResolvedChildSpec.model` still intentionally preserves the raw registry object for valid models. This repair only guarantees the resolver's identity parse uses own string data descriptors and does not invoke accessor-backed `provider` / `id` properties.
