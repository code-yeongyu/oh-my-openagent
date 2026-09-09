## What

- Make GPT-6 Astra the default model family across the catalog, worker/verifier roles, and all 12 bundled agents. Use a 600000-token context window, high reasoning, and xhigh plan reasoning while keeping each agent's existing reasoning default.
- Add a Hephaestus `gpt-6` variant selected for the GPT-6 family, reconciled against the actual senpi Astra preset and its imported guidance in Codex dialect. Keep the GPT-5.5 and GPT-5.6 variants.
- Register Astra and Astra-fast for the 600k post-compact budget, preserving the unknown-model fallback.
- Treat GPT-6 as multi_agent v2 when the model catalog is unavailable.
- Never write or raise thread caps. Remove LazyCodex-written `agents.max_threads = 1000` and V2 concurrency values 1000/16, including quoted/escaped keys and inline comments. Preserve other user values, except that V2 removes the incompatible V1-only `agents.max_threads` key.
- Retain the legacy Sol/650k managed profile for upgrades, fix the catalog-trio legacy-profile drift, and regenerate the committed installer bundle.

## Why

Keep the root model, installed agents, rules persona, context budgeting and model-family detection consistent with the Astra default. Let Codex defaults and deliberate user concurrency settings govern admission instead of silently forcing unusually high caps. Preserve supported customized model and reasoning settings during installation.

Addresses #130 #145

## Observed

Remote evidence is in `.omo/evidence/20260908-lcx-astra/task-gate-a-remote-tests.log`:

- mengmotaMac at `e87691a6a`: [a] scoped Bun including bundle freshness, [b] canonical rules Vitest, [c] plugin Node suite and [e] markdown audit all `TEST_EXIT=0` (378/0 plus one platform skip, 171/0, 336/0 and 16/0 respectively).
- The initial full `test:codex` run failed at a 20-second installer timeout. The recorded rerun at `b8485e334` returned `TEST_EXIT=0`: Bun 465 pass/1 skip/0 fail and final Node 495 pass/0 fail.
- A later installer-only run timed out a different case under heavy mengmotaMac load. gorky branch/dev/branch/dev A/B runs all passed 11/0; branch minimum 7.78s versus dev 7.41s (1.05x), classified as LOAD ARTIFACT. Failed runs and cleanup receipts remain in the log.
- At the final source HEAD, Bun 1.4.0 rebuilt the committed installer with a clean tracked tree; the actual plugin build and scoped Codex typecheck returned 0. Only evidence changed after those tested product revisions.
- Real isolated installs observed Astra/600k/high/plan-xhigh, 12 Astra agents, absent caps, legacy Sol upgrade, preserved Terra/medium/cap-4, and preserved explorer xhigh reasoning.
- Real Codex 0.144.1 with the local mock emitted matching `hook/started` and successful `hook/completed` pairs for rules SessionStart/UserPromptSubmit and ultrawork UserPromptSubmit. The bare mock turn completed. The plugin run did not finish its turn before the driver's deadline; this is not reported as an all-green app-server run.
- Raw-pipe SessionStart evidence matches the current shipped body and contains `based on GPT-6`. Corrected post-compact recovery evidence measured Astra/Sol guides at 4087 characters versus unknown-model at 665.

## QA evidence

All paths are under `.omo/evidence/20260908-lcx-astra/`:

- `what-tested.md`, `observed.md`, `why-enough.md`, `omitted.md`: scope, commands, results, verifier repairs and limits.
- `task-7-ship.log`, `task-7-typecheck.log`, `task-7-diagnostics.log`: build, freshness and validator outputs.
- `task-7-install-qa.log`, `task-7-install-qa-continued.log`, `task-7-*-assertions.json`, config seeds/results and installer logs: real install behavior, including failures.
- `task-7-app-server-self-test.log`, `task-7-app-server-plugin.log`, `task-7-hook-pairs.json`: first-party live hook proof and full-turn limitation.
- `task-7-session-start-reuse.log`, `task-1-hephaestus-gpt6.log`, `task-1-preset-mapping.md`, `task-3-budget.log`: rule selection, preset reconciliation and post-compact proof.
- Task 1-6 logs and `task-gate-a-remote-tests.log`: implementation, verifier-driven RED/GREEN repairs, broad gates and A/B.

Real `~/.codex/config.toml` SHA-1 before and after: `b012e531f5aa9fb1bce9003593c3eadf07081fcd`. Every live process used isolated CODEX_HOME, HOME and XDG directories; no real auth or `.omo` state was used. No local Bun tests, agentic probes, real model turns or product edits were made by the evidence task.

## Residual risk and unresolved QA

- **Malformed config refusal failed:** an unterminated model string was overwritten and the installer returned 0, contrary to the plan's expected refusal. Seed, result, checksums and failed assertion are retained. Baseline attribution is unverified; no source fix was authorized in this ship task.
- **Plugin mock turn incomplete:** required hook pairs completed, but `turnStatus` and assistant text stayed null until the unchanged 90000ms deadline. Root cause is unverified. CI/review and this QA result require orchestrator disposition before merge.
- **Hook-count contract distinction:** source and installed marketplace snapshot contain 21 hooks; the macOS runtime cache has 19 because the existing installer removes exactly two Windows-only Git Bash hooks. The initial `19 !== 21` assertion is retained. Active-cache/source count equality is not claimed.
- Broad LSP inspection reported existing missing ast-grep exports in unchanged bootstrap files; the requested scoped package typecheck passed. The new evidence driver has clean diagnostics.
- Mock and raw-pipe probes do not test real Astra behavior, quota, latency, instruction adherence or model-driven multi-agent admission. Host-load sensitivity remains visible in installer test history.

This PR is opened for the orchestrator's CI/review/merge lifecycle. It is not a claim that all todo-7 acceptance criteria are green. No merge or required-check override has been performed.
