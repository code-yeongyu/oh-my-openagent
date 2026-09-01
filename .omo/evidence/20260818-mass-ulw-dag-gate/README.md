# QA Evidence — mass-ulw dag planning gate (2026-08-18)

Branch: `feat/mass-ulw-dag-gate` (from origin/dev 4f65026b8)

## What was tested

1. **P1 advisory warnings** — `dag` `start` lints every definition against the mass-ulw node
   prompt contract (TASK:/STOP WHEN markers, verification-wave presence) and returns advisory
   `warnings` in the result. Never rejects.
   - RED: `dag-lint.test.ts` + `dag-tool.test.ts` warnings tests failing before implementation
     (module missing / `warnings` undefined).
   - GREEN: same tests passing (`p1-green.txt`).
   - Real surface: `packages/omo-senpi/scripts/qa/dag-gate-proof.ts` drives the actual `runDagTool` with a real
     `DagManager` and prints the exact model-visible text + payload for a violating and a
     compliant definition (`p1-real-surface.txt`).
2. **P2 spawn-policy alignment** — dag agent-routed (`subagent_type`) node dispatch now passes
   through `evaluateSpawnPolicy`, the same gate direct `task` spawns use.
   - RED: `scheduler.test.ts` policy tests failing before implementation (node completed instead
     of being denied; forced prompt not applied) (`p2-red.txt`).
   - GREEN: scheduler unit tests + `dag-runtime.test.ts` wiring test (denying policy reaches
     dispatch through the real composition root; no child starts) (`p2-green.txt`).
   - Real harness: `plan-gated-agents-e2e.mjs` (the repo's canonical plan-gate driver) against
     the built plugin bundle (`plan-gated-e2e.txt`).
3. **Regression** — full suites: `bun test packages/senpi-task` (1614 pass), full
   `bun test packages/omo-senpi` post skill-sync, `tsgo --noEmit` on both packages
   (`regression.txt`).

## What was observed

- Violating 2-node definition starts AND returns 5 advisory warnings (4 contract + 1
  verification-wave) in both the text and the details payload; compliant definition returns `[]`.
- A dag node with `subagent_type: "momus"` under a denying policy fails with the denial message
  and `startOwned` is never called; a `force` verdict replaces the prompt the child receives;
  category-routed nodes never consult the policy.
- Pre-existing failures: full-suite A/B vs clean origin/dev shows the same 16 environment-dependent failures on both sides (init-deep-advisor, cli-local, installer, product-identity families); branch failures are a strict subset. Zero new failures from this change.
- Pre-existing environmental note: `skills-sync.test.ts` requires `sync-skills.mjs` to have run
  (CI's `test:senpi` builds first); a fresh worktree with `--ignore-scripts` shows 7 unrelated
  failures until `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` runs once.

## Why it is enough

- P1's surface is the tool result itself; the proof script exercises the real tool + manager,
  which is the exact surface the model consumes.
- P2's mechanism is proven at the scheduler (unit) and at the composition root (runtime wiring
  test with a real engine); the canonical e2e proves the direct-spawn gate still behaves
  identically after the barrel/wiring changes.
- Residual risk: the momus prompt-contract `force` path is proven at scheduler level; the live
  plan-gate e2e covers the direct-spawn path, not a dag-dispatched momus (no mock-provider dag
  e2e harness exists in the repo yet).

## What was omitted

- No secrets, tokens, or env dumps captured. The e2e sandbox digest-compares the real agent dir
  before/after (isolation proof inside the driver itself).
