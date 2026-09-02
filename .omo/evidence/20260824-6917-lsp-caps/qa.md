Issue #6917 evidence: guard long-run visual-engineering waves (lsp budget, concentration warning, detach peek hint)

## WHAT WAS TESTED

1. Failing-first regression tests (written BEFORE the fix, co-located, given/when/then):
   - packages/senpi-task/src/runners/in-process/lsp-call-cap.test.ts
     - lsp_ family classification; per-gate admission up to the budget then refusal; wrapper identity
       semantics (non-lsp tools untouched by reference); within-budget pass-through for all 10 calls;
       blocked call returns guidance naming ast-grep/explore without running the underlying tool;
       independent counters per capped tool set.
   - packages/senpi-task/src/tools/task/batch-concentration.test.ts
     - threshold pinned to 4; observation extraction (category items only, explicit subagent items and
       missing models ignored); warning fires for 4 same-category tasks on one provider model; no
       warning at 3, when split across two models, or across two categories; empty/partial observations
       never crash.
   - packages/senpi-task/src/tools/task/execute-batch-concentration.test.ts
     - wiring through buildTaskExecute: a 4-item visual-engineering wave resolving to one model carries
       the "Provider concentration warning" line in the tool result text; 3-item and dispersed waves do not.
   - packages/senpi-task/src/tools/task/start-presentation.test.ts (extended)
     - backgroundConversionText keeps the pinned "prompt-cache-safe budget (270s)" line and adds the
       task_output(task_id, mode:"tail") peek guidance with the 4-peeks respawn hint.

2. Scoped unit gates after the fix:
   - bun test packages/senpi-task  -> 1761 pass, 1 skip, 0 fail (249 files) [gate-green.txt]
   - bunx tsgo --noEmit -p packages/senpi-task/tsconfig.json  -> clean
   - bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json   -> clean (consumer typecheck)
   - bun test packages/omo-senpi/src/components/task -> 478 pass, 0 fail (63 files)
     [senpi-adapter-task-scoped.txt] (the omo-senpi component that consumes this engine)

## WHAT WAS OBSERVED

- RED first: with only the tests present, the scoped run failed exactly as intended:
  4 fail + 3 "Cannot find module" errors for ./lsp-call-cap and ./batch-concentration, and the
  peek-hint assertion failed against the old two-line conversion text [gate-red.txt].
- GREEN after the minimal fix: all new tests pass, the full senpi-task suite stays at 1761 pass /
  0 fail, including the pre-existing execute-batch and execute-budget-wait suites that pin existing
  result strings (no behavior regression on unchanged paths).
- Isolation: worktree-only QA; no harness session stores touched. No secrets in artifacts.

## WHY IT IS ENOUGH

- The three guardrails are enforced as machine-consumed runtime behavior (tool-result text and tool
  surface wrapping), which is the sanctioned test seam here; no authored prose is asserted.
- The cap sits at buildChildSessionOptions, the single assembly point for every in-process child's
  custom tools, so category-routed workers cannot burst 30+ lsp_* calls regardless of prompt discipline.
- The concentration lint runs on the resolved_model facts of started batch items, i.e. exactly the
  wave shape the issue reports (5 visual-engineering tasks on one provider model).
- Consumer compatibility is proven by the omo-senpi task component suite (478 pass) plus clean
  typechecks on both packages.

## WHAT WAS OMITTED

- Live end-to-end drive of the real senpi binary was not run in this environment: the full
  packages/omo-senpi suite hangs here on its git-worktree-spawning fixture (env quirk; see the
  truncated capture in senpi-adapter-gate.txt). Its failures are confined to build-artifact
  comparison suites ("scoped skill sync", "checkExtensionCurrent") whose inputs are the committed
  plugin bundle and a dist/ build that does not exist in this fresh worktree; they predate this diff,
  which touches only senpi-task sources and runs no build. Compensating coverage: scoped consumer
  suite (478 pass) and both package typechecks listed above.
- Process-mode (RPC runner) children are out of scope: the cap wraps the in-process shared parent
  tool surface named by the issue's reproduction path (in-process default execution mode).
- No raw logs, tokens, or environment dumps are included in this directory.
