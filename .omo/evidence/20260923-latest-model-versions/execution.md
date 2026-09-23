# Execution map

The task-owned worktree is on `fix/latest-model-versions` at `33d9e8a4`.
The supplied plan predates changes already present in this exact base:
the scoped provider references already use `chatgpt-subscription`, and the
Opus rungs already use 5.5 but lack the older Opus 5 coverage.

## Edit and verification units

1. Audit the two model-core requirement tables, their tests, and
   `packages/senpi-task/src/category/` for retired provider references.
   No replacement is necessary in the current base. Preserve the wire API id.
2. In `packages/model-core/src/agent-model-requirements.ts`,
   `category-model-requirements.ts`, and the Senpi category mirror
   `packages/senpi-task/src/category/fallback-chains.ts`, retain the Opus 5.5
   position and restore an Opus 5 rung immediately after it. The 5.5 rung uses
   the already-listed providers confirmed by the plan's catalog: `anthropic`,
   plus `anthropic-subscription` on the Senpi mirror. The older rung retains
   the previous provider coverage and variant.
3. Replace GLM 5.2 and Qwen 3.7 Plus in the agent requirement table with
   GLM 5.3 and Qwen 3.8 Max. Max is the non-flash tier choice. Preserve the
   provider lists as prescribed by the replacement action.
4. Update the pinned expectations in `model-requirements-agents.test.ts`,
   `model-requirements-categories.test.ts`, `category-routing-policy.test.ts`,
   and Senpi's `fallback-chains.test.ts`. Add resolution coverage at the
   existing resolver seam for an Opus-5-only registry and a 5.5 registry.
   Update other co-located affected assertions only when they pin these rungs.
   Observe a failing regression before changing production tables.
5. Audit docs, READMEs, and web messages for live provider references.
   `codex@openai-codex` is a plugin identity, not a provider reference.
   Telemetry's vocabulary intentionally retains both old and new provider
   labels and already documents `chatgpt-subscription`; do not falsify that
   accepted-value contract.
6. Keep `deepseek/deepseek-v4-flash`: the exact requested CLI check returned
   no `deepseek` provider for v4.1-flash. Keep Gemini 3.1 Pro as prescribed:
   the plan records no Pro successor. Record both exceptions in report/PR.
7. Run the current-tree package tests, Opus audit, Senpi tsconfig typecheck,
   and `bun run test:senpi`. Allow the full Senpi gate twenty minutes; if it
   times out, the user accepts the focused suites plus typecheck with an
   explicit limitation in the report and PR. Run isolated real Senpi QA
   using the repository driver and its resolved evidence directory.
   No additional formatter gate or formatting sweep is part of this change.
   Capture exact results in `report.md`.
8. Review the complete diff and evidence before committing, fast-forward
   pushing to `submission`, and opening the explicitly requested upstream PR.

No new worktree or merge is needed: the user supplied the task-owned worktree
and explicitly ends the task at PR creation. No generated artifacts belong
in the submitted diff. The required `test:senpi` command itself includes the
repository's plugin build; its transient outputs are not model-catalog
regeneration and must not be submitted.
