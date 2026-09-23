# Latest model requirement chains: blocked local handoff

Date: 2026-09-23
Branch: `fix/latest-model-versions`
Base and current HEAD: `33d9e8a46e2eed2eb0177d7fb66f99e26e17e510`

## Status

The model requirement update and focused resolver coverage are implemented locally, but the current-tree package gate is red on an existing capability-snapshot invariant. No commit, push, or PR was made.

`qwen3.8-max` is present in the installed catalog and resolves through the changed chain, but the checked-in generated capability snapshot contains only `qwen3.8-max-preview`. Consequently `getModelCapabilities` reports `heuristic-backed` for the newly shipped rung, while `model-capabilities.test.ts` requires every built-in requirement model to be snapshot-backed, alias-backed, or unknown. Clearing the failure requires one of three out-of-scope actions: regenerate/edit the forbidden generated capability artifact, add a capability alias outside the file scope, or weaken the invariant. None was performed.

The repository has no root Biome configuration or dependency. Per the user's correction, Biome is not a gate and no whole-file formatting was done.

## WHAT WAS TESTED

All commands ran from this task-owned worktree.

### Catalog availability

- `omo --offline --list-models claude-opus-5-5`: exact rows included `anthropic`, `anthropic-subscription`, and `venice`; no GitHub Copilot or OpenCode row.
- `omo --offline --list-models claude-opus-5`: exact rows included `anthropic`, `anthropic-subscription`, `github-copilot`, and `opencode`.
- `omo --offline --list-models glm-5.3`: exact rows included `opencode` and `opencode-go`, plus other providers.
- `omo --offline --list-models qwen3.8-max`: exact rows included `opencode-go`, `alibaba-token-plan`, and the Qwen token-plan providers.
- `omo --offline --list-models deepseek-v4.1-flash`: no row used provider id `deepseek`; that chain stays on `deepseek-v4-flash`.
- `omo --offline --list-models gemini`: Gemini 3.1 Pro/preview rows existed; later 3.5-3.8 rows were Flash variants, not Pro successors. The chain stays on `gemini-3.1-pro`.

### Failing-first and focused regression

Before production edits:

`bun test packages/model-core/src/latest-model-requirements.test.ts` -> exit 1, **1 pass / 3 fail**. The Opus 5, GLM 5.3, and Qwen 3.8 Max fixtures all fell to `system/default`.

After the requirement/test edits:

`bun test packages/model-core/src/latest-model-requirements.test.ts packages/model-core/src/model-requirements-agents.test.ts packages/model-core/src/model-requirements-categories.test.ts packages/model-core/src/category-routing-policy.test.ts packages/senpi-task/src/category/fallback-chains.test.ts` -> exit 0, **38 pass / 0 fail**.

The new regression fixtures are independent catalog observations recorded above. They invoke the public resolver and fail if a shipped chain no longer resolves the catalog-present Opus, GLM, or Qwen model; they do not compare one copied list to another.

### Required current-tree gates

| Exact command | Result |
| --- | --- |
| `PATH="$PWD/node_modules/.bin:$PATH" tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | Exit 0; no type errors. |
| `bun test script/opus5-model-recommendation-audit.test.ts` | Exit 0: **1 pass / 0 fail**, 1 file, 3.50 seconds. |
| `bun test packages/model-core packages/senpi-task` | Exit 1: **2,991 pass / 1 skip / 2 fail**, 2,994 tests across 390 files, 61.10 seconds. One failure was a stale Senpi provider-list expectation and was corrected; the remaining failure is the out-of-scope Qwen capability snapshot invariant. A focused rerun after that correction produced **37 pass / 1 fail** across the two implicated files. |
| `bun run test:senpi` | Exit 1: **3,731 pass / 32 skip / 4 fail**, 3,767 tests across 451 files, 328.31 seconds. It completed within the accepted 20-minute budget, so the timeout exception does not apply. This command built tracked plugin bundles as part of its normal script; those artifacts are not intended for submission. |

Focused reruns after correcting the stale Senpi expectation:

- `bun test packages/senpi-task` -> exit 0: **2,586 pass / 1 skip /
  0 fail**, 2,587 tests across 354 files, 61.82 seconds.
- `bun test packages/model-core` -> exit 1: **406 pass / 1 fail**,
  407 tests across 36 files, 1.61 seconds. The sole failure is the Qwen
  capability-snapshot invariant described above.
- `bun test packages/model-core/src/model-capabilities.test.ts
  packages/senpi-task/src/category/resolve-category.test.ts` -> exit 1:
  **37 pass / 1 fail**. The corrected Senpi category test passes; only the
  capability invariant remains.

The focused `bun test packages/omo-senpi` reproduction was stopped after
4 minutes 23 seconds once the independent required package blocker above
was proven unfixable within scope. It had not emitted a final count. The
full Senpi gate's aggregate four failures therefore remain only partially
decomposed: one stale Senpi expectation is fixed and passes focused; the
Qwen capability invariant remains; the other full-gate failures were not
isolated before work stopped.

### Real Senpi smoke

- Evidence: `.omo/evidence/omo-senpi-adapter/20260923-latest-model-versions/README.md`
- Receipt: `.omo/evidence/omo-senpi-adapter/20260923-latest-model-versions/drive.json`
- Resolver self-test: exit 0, `SELF-TEST OK`.
- Fresh real process: `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/drive.mjs` -> exit 0, `result: PASS`, `ultraworkInjected: true`.
- Disclosed limitations: comment checker skipped because its binary was unavailable. Darwin lacks the driver's Linux-only directory-identity primitive, so home-isolation certification is not claimed; protected snapshots were complete and every changed-path array was empty. The disposable sandbox was removed after child completion (`QA_SANDBOX_REMOVED`).

## WHAT WAS OBSERVED

The exact requested base already used `chatgpt-subscription` in every scoped live provider reference and already carried Opus 5.5 rungs; it had dropped the older Opus 5 coverage. The local change:

- limits model-core Opus 5.5 rungs to catalog-confirmed `anthropic`, then restores the previous provider coverage as an Opus 5 rung immediately below;
- preserves Senpi's existing subscription precedence on 5.5 with `["anthropic-subscription", "anthropic"]`, then restores its previous provider coverage on Opus 5;
- replaces `glm-5.2` with `glm-5.3` and `qwen3.7-plus` with the same non-Flash tier, `qwen3.8-max`;
- updates every scoped pinned expectation, including the Senpi resolver expectation found by the package gate.

The user requested that the PR explain that `anthropic-subscription` serves Opus 5.5 but is deliberately not added to model-core's provider list as a minimal-diff choice and follow-up candidate. Senpi's existing subscription-specific mirror retains that provider because it is already part of that adapter's provider precedence contract.

Remaining `codex@openai-codex` docs occurrences are a Codex plugin identity, not a provider id. The telemetry vocabulary intentionally accepts both provider generations for older binaries. The wire API id was not changed.

## WHY IT IS ENOUGH

The evidence proves catalog availability, chain selection, exact pinned ordering, TypeScript compatibility, and a fresh real Senpi plugin load. It is not enough to submit because the required package and full Senpi gates are red. The residual Qwen failure is not safely repairable within the approved scope without touching a forbidden generated artifact, expanding into capability aliases, or weakening a test.

## WHAT WAS OMITTED

- No Biome command is part of verification.
- No model-capability generation or hand-edit of generated capability data.
- No capability alias or weakened invariant.
- No paid provider inference or per-provider remote call.
- No whole-home isolation certification on Darwin and no comment-checker result.
- No completed focused `packages/omo-senpi` rerun after the full-gate failure;
  it was terminated after the independent submission blocker was established.
- No commit, push, PR, or merge while required gates remain red.
- The required Senpi build modified tracked plugin bundles in the local working tree; they are generated artifacts and would be excluded from any submission.


## Post-delegation update (parent lane)

- Qwen bump reverted to `qwen3.7-plus`: `qwen3.8-max` is the catalog's newest 3.8 but is not snapshot-backed, and the capability snapshot is generated from models.dev (not offline-safe to refresh) — recorded as a follow-up.
- `packages/model-core/src/model-capabilities.test.ts` stub snapshot extended with `claude-opus-5` and `glm-5.3` so the "every requirement model is snapshot-backed" invariant holds for the new rungs.
- Gates re-run on the final tree: `bun test packages/model-core packages/senpi-task` = 2989 pass / 1 skip / 0 fail (baseline identical); `bun test script/opus5-model-recommendation-audit.test.ts` = 1 pass.
- `bun run test:senpi`: still running at commit time.
- Regenerated `packages/omo-senpi/plugin/**` bundles are included: tracked release artifacts rebuilt from the changed sources (repo history: `build(omo-senpi): regenerate...`).


## Final gate state (delivery)

- `bun run test:senpi` -> 3735 pass, 0 fail, exit 0.
- `bun test packages/model-core packages/senpi-task` -> 2993 pass, 1 skip, 0 fail (run in isolation).
- `bun test script/opus5-model-recommendation-audit.test.ts` -> 1 pass.
- Qwen correction: the category chain keeps the shipped `qwen3.8-max-preview` and the agent chain keeps `qwen3.7-plus`; the un-suffixed `qwen3.8-max` is not snapshot-backed, so a version bump there is a follow-up that includes regenerating the models.dev-derived capability snapshot.
- Curated senpi chains (plan-consultant/plan-reviewer parity) and the telemetry vocabulary follow the same ids.
