# Evidence - 20260824-6813-registry-recs (Fix #6813)

## WHAT WAS TESTED

### Original overlay implementation

1. Failing-first overlay regressions for OpenAI-only category and agent resolution.
2. Scoped delegate-core, senpi-task, and omo-senpi suites.
3. Package typechecks for delegate-core, senpi-task, and omo-senpi.

### 2026-09-02 Cubic review repair

1. Reviewed-head red proof across the category and agent overlay suites. The new assertions cover:
   - retained builtin runtime fallback models after the maintained agent recommendation;
   - artistry and writing in public and result-local available-category listings;
   - deterministic `model_unavailable` classification for a poisoned registry inventory.
2. Focused repaired-state tests:
   `bun test packages/senpi-task/src/agents/openai-only-agent-overlay.test.ts packages/senpi-task/src/category/available-categories.test.ts packages/senpi-task/src/category/openai-only-overlay.test.ts packages/senpi-task/src/category/resolve-category-boundary.test.ts`.
3. Static gates:
   - `tsgo --noEmit -p packages/senpi-task/tsconfig.json`;
   - `tsgo --noEmit -p packages/omo-senpi/tsconfig.json`;
   - the TypeScript no-excuse checker across all changed TypeScript files.
4. Full package gates:
   - `bun test packages/senpi-task`;
   - `bun run test:senpi`.
5. Real Senpi 2026.9.2 QA through the repository drivers:
   - `drive.mjs --self-test`;
   - `task-e2e.mjs`;
   - `task-runtime-fallback-e2e.mjs`;
   - `curated-agents-e2e.mjs`.
6. Every non-green live-driver assertion was rerun from exact clean base commit
   `60c8577fca325cc5680730ca9aaf0e80ce202785`, with the same Senpi binary and freshly built payload.

## WHAT WAS OBSERVED

- Reviewed-head RED: `22 pass / 4 fail / 52 expect()`. The four failures were exactly the missing
  agent fallback list and missing artistry/writing availability listings. The stronger poisoned
  inventory assertion already passed.
- Repaired focused GREEN: `35 pass / 0 fail / 122 expect()`.
- senpi-task typecheck: exit 0.
- omo-senpi typecheck: exit 0.
- TypeScript no-excuse checker: no violations in eight changed TypeScript files.
- Full senpi-task gate: `1813 pass / 1 skip / 0 fail / 5990 expect()` across 255 files.
- Full omo-senpi gate: `2521 pass / 7 skip / 0 fail / 8029 expect()` across 334 files. The evidence
  path resolver tests also passed `10 / 10`.
- Driver self-test: `SELF-TEST OK`.
- Real runtime fallback QA:
  - `user-fallback=PASS`;
  - `builtin-chain-fallback=PASS`, including the fallback event and exact two-model attempt chain;
  - `chain-exhausted` reached `task_failed=PASS`, while its separate `exhausted_event` assertion
    failed identically on clean base.
- Real curated-agent QA passed model-source recording, category listing, agent/tool recording,
  mutation-tool hiding and rejection, LSP invocation, bash read, process exit, file integrity, and
  real-home isolation. Four prompt/context-capture assertions failed with zero child context captures
  both on this branch and on clean base.
- Real task lifecycle QA passed the directly relevant spawn, model, error, resume-child,
  continuation, cancellation, killed-task, LRU, TTL setup/expunge, isolation, and cleanup surfaces.
  Six follow-up/resume assertions failed with the exact same check map and state signatures on clean
  base. In both runs the child completed, the parent settled without executing the scripted follow-up,
  the main process exited 0, the real Senpi home was unchanged, and no PIDs leaked.
- All branch and clean-base live runs reported unchanged real Senpi paths and zero leaked PIDs.

The local driver artifacts and clean-base comparisons are organized under
`.omo/evidence/omo-senpi-adapter/20260902-pr-7251-overlay-repair/`.

## WHY IT IS ENOUGH

The regression tests distinguish every repaired review defect from its fallback state. They prove
that the maintained OpenAI-only recommendation remains the requested agent model while later
available builtin rungs remain runtime retries, and that runtime-resolvable overlay categories are
also discoverable without a second registry sample. The poisoned-inventory test proves the shared
registry boundary still fails closed.

The full engine and adapter suites cover chain selection, category gates, registry parsing, generated
payload integration, and concrete Senpi registry types. The real runtime fallback driver proves that
the built extension executes fallback behavior through Senpi rather than only through unit seams. The
curated-agent driver separately proves the built extension records model sources and category
listings. Every remaining live-driver failure has an exact clean-base reproduction under the same
binary and freshly built payload, so it is not introduced by this repair.

## WHAT WAS OMITTED

- The ignored local live-driver directory is not included in the tracked diff. Its reviewer-readable
  results are summarized here, while raw output containing machine-local paths stays local.
- Raw driver output containing machine-local absolute paths stays in the ignored local directory.
  No credentials, tokens, or private configuration are copied into tracked evidence.
- The current-base Senpi 2026.9.2 follow-up/context-capture driver incompatibilities are not repaired
  in this PR because they reproduce byte-for-byte in behavior on the clean base and are outside the
  OpenAI-only registry recommendation change.
