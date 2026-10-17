# OpenCode V2 plugin entry compatibility

## Goal

Allow the published default plugin definition to pass OpenCode V2's entrypoint validation while preserving the existing OpenCode V1 `server` entrypoint.

## Scope

1. Extend `createPluginModule()` with the smallest dual-generation definition: the existing `id` and `server`, plus a V2 `setup` entrypoint.
2. Add one focused regression assertion to the existing plugin-module factory test proving both entrypoints remain present and callable.
3. Update the local source documentation that currently describes the module as `{ id, server }`.
4. Run the focused regression, repository typecheck/build/test gates, and isolated real-OpenCode loader QA required by `opencode-qa`; save reviewer-readable evidence under `.omo/evidence/20260914-opencode-v2-plugin-entry/`.

## Boundaries

- This is loader compatibility only. It does not translate the V1 hooks and tools into the V2 domain APIs.
- Do not change package versions, unrelated initialization behavior, or existing V1 lifecycle wiring.
- Preserve the unrelated pre-existing evidence-file modification in this worktree.
