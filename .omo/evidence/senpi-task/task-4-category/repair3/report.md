# Todo 4 Category Resolver Repair 3

worktree: `/Users/yeongyu/local-workspaces/omo-wt/senpi-task-w0-category`
branch: `code-yeongyu/senpi-task-w0-category`
base: `27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4`
starting head: `cdce632e5ef7e984ce66200d86b5220c79089fcd`

## Root Cause And Toggle Proof

The model-boundary parser had two opposing boundary errors:

- False negative: `headers` was listed as sensitive, so a valid Senpi model object with own string `provider`/`id` and legal top-level `headers` returned `model_unavailable`.
- False positive: the parser used inherited-property checks for identity, and its exact sensitive-field set missed common own secret-like keys such as `password` and `accessToken`.

Red proof:

- Invocation: `bun test packages/senpi-task/src/category`
- Binary observable: exit `1`
- Artifact: `.omo/evidence/senpi-task/task-4-category/repair3/red-category-model-boundary-tests.log`
- Exit artifact: `.omo/evidence/senpi-task/task-4-category/repair3/red-category-model-boundary-tests.exit`
- Observed failures: header-bearing model returned `model_unavailable`; own `password`/`accessToken` secret probes resolved; inherited `provider`/`id` model resolved.

Green proof:

- Parser now requires own `provider` and `id` fields plus string values.
- Parser allows legal metadata such as `headers`.
- Parser rejects own secret-like property names after case-insensitive separator normalization, before a raw registry object can become `ResolvedChildSpec.model`.

## What Was Tested

Unit boundary scenario:

- Invocation: `bun test packages/senpi-task/src/category`
- Surface: category resolver unit tests.
- Behavior: valid `{ provider, id, headers }` resolves; own `password`, `accessToken`, and `privateToken` reject as `model_unavailable` without serializing `hidden`; inherited `provider`/`id` rejects without serializing prototype data.
- Artifacts: `01-category-tests.log`, `01-category-tests.exit`

Package regression scenario:

- Invocation: `bun test packages/senpi-task --bail`
- Surface: full `senpi-task` test package.
- Behavior: category, state, store, transitions, and tripwire tests still pass with the boundary hardening.
- Artifacts: `02-senpi-task-bail.log`, `02-senpi-task-bail.exit`

Type and rule scenario:

- Invocation: `bun run typecheck`
- Surface: repo TypeScript project references, including `packages/senpi-task/tsconfig.json`.
- Binary observable: exit `0`.
- Artifacts: `03-typecheck.log`, `03-typecheck.exit`

- Invocation: `bun run packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts packages/senpi-task/src/category packages/senpi-task/scripts/manual-category-qa.ts packages/senpi-task/src/index.ts`
- Surface: scoped TypeScript no-excuse rule checker.
- Binary observable: exit `0`.
- Artifacts: `05-no-excuse-ts-guard.log`, `05-no-excuse-ts-guard.exit`

Manual QA scenario:

- Invocation: `bun run packages/senpi-task/scripts/manual-category-qa.ts`
- Surface: executable category resolver QA script.
- Behavior: happy, disabled, unavailable, hardcoded fallback, system default, legal headers, malformed registry, secret field rejection, inherited identity rejection, non-array availability, and prototype category-name scenarios.
- Artifacts: `04-manual-category-qa.log`, `04-manual-category-qa.exit`

Hygiene scenarios:

- Invocation: `git diff --check 27fc9ca95abfa266e0b2e0e3efa44b56ec8b9ab4...HEAD -- packages/senpi-task/src/category packages/senpi-task/src/index.ts packages/senpi-task/scripts/manual-category-qa.ts`
- Binary observable: exit `0`.
- Artifacts: `06-diff-check.log`, `06-diff-check.exit`

- Invocation: pure LOC `awk` check over touched TypeScript files.
- Binary observable: exit `0`.
- Artifacts: `07-loc-check.log`, `07-loc-check.exit`

- Invocation: zero-byte artifact check under `repair3/`.
- Binary observable: exit `0`.
- Artifacts: `08-zero-byte-artifact-check.log`, `08-zero-byte-artifact-check.exit`

- Invocation: scoped sensitive evidence scan over touched TypeScript files and `repair3/`.
- Binary observable: exit `0`.
- Artifacts: `09-sensitive-scan.log`, `09-sensitive-scan.exit`

## What Was Observed

- `01-category-tests.log`: 16 pass, 0 fail.
- `02-senpi-task-bail.log`: 45 pass, 0 fail.
- `03-typecheck.log`: `tsgo --noEmit` gates completed with exit `0`.
- `04-manual-category-qa.log`: `headerBearing.kind` is `resolved`; all three `secretFind` entries are `model_unavailable`; `inheritedIdentity.kind` is `model_unavailable`.
- `05-no-excuse-ts-guard.log`: `No violations in 12 file(s).`
- `06-diff-check.log`: `PASS git diff --check against Todo 4 base for scoped files`.
- `07-loc-check.log`: `resolver.ts` 245 pure LOC, `resolve-category.test.ts` 281 pure LOC, `manual-category-qa.ts` 156 pure LOC.
- `08-zero-byte-artifact-check.log`: no zero-byte artifacts under `repair3/`.
- `09-sensitive-scan.log`: only expected adversarial fixture field names and the literal test marker `hidden` were found; no raw credential-looking tokens were found.

## Why Enough

The red run proves the tests fail on the exact review3 blockers before the parser change. The green unit run proves the resolver now accepts legal header-bearing Senpi models while rejecting own secret-like keys and inherited identity fields. The manual QA script drives the same behavior through the executable QA surface used for Todo 4 evidence. Typecheck and no-excuse checks cover strict TypeScript and escape-hatch constraints, and diff/LOC/artifact/sensitive scans cover the requested evidence hygiene.

## What Omitted

- No real provider network/API call was made. The resolver boundary is pure and the requested surface is the Senpi model registry port plus manual QA script.
- No OpenCode or Codex harness QA was run because this change is scoped to `packages/senpi-task`, not `packages/omo-opencode` or `packages/omo-codex`.
- No raw secrets, auth headers, env dumps, or private credentials were copied. The string `hidden` appears only as an adversarial test marker.

## Residual Risk

- `resolve-category.test.ts` is 281 pure LOC after this repair. It was already a broad boundary test file; splitting it would be a separate test-organization change outside this minimal repair. Product file `resolver.ts` is under the 250 pure-LOC ceiling at 245.
- The secret-like field predicate is intentionally conservative for own top-level keys and does not inspect nested legal `headers` contents. That preserves Senpi `Model<Api>` compatibility and avoids leaking raw model objects with obvious top-level secret-bearing fields.

## Cleanup

- Evidence is contained under `.omo/evidence/senpi-task/task-4-category/repair3/`.
- No temp scripts or external artifacts were created outside the requested evidence directory.
