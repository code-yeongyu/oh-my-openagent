# Plan: Issue #6484 - doctor reports "Model cache not found" persistently

## Root cause (traced end-to-end, fresh from disk @ 8c57e463e)

- Doctor read path: `packages/omo-opencode/src/cli/doctor/checks/model-resolution-cache.ts`
  `loadAvailableModelsFromCache()` reads ONLY `join(getOpenCodeCacheDir(), "models.json")`
  = `~/.cache/opencode/models.json`. Repo-wide grep proves NO code path ever writes that file.
- Refresh write path: `packages/omo-opencode/src/shared/connected-providers-cache.ts`
  `updateConnectedProvidersCache()` (triggered by the auto-update-checker session hook and
  `opencode models --refresh`) writes `~/.cache/oh-my-opencode/provider-models.json`
  (shape `{ models: Record<providerId, string[] | ModelMetadata[]>, connected, updatedAt }`)
  and `connected-providers.json` via `createJsonFileCacheStore`.
- Runtime truth: `packages/omo-opencode/src/shared/model-availability.ts`
  `isModelCacheAvailable()` accepts omo's provider-models cache OR legacy models.json;
  `fetchAvailableModels()` prefers provider-models cache. The doctor never got the same
  treatment, so stock users always see "Model cache not found".

## Fix (issue option 1 + maintainer mid-term suggestion)

1. `packages/omo-opencode/src/shared/connected-providers-cache.ts`: export
   `PROVIDER_MODELS_CACHE_FILE = "provider-models.json"` (single source of truth for filename).
2. `packages/omo-opencode/src/cli/doctor/checks/model-resolution-types.ts`: add optional
   `cachePath?: string` to `AvailableModelsInfo`.
3. `packages/omo-opencode/src/cli/doctor/checks/model-resolution-cache.ts`:
   - Read omo cache first: `join(getOmoOpenCodeCacheDir(), PROVIDER_MODELS_CACHE_FILE)`;
     reshape `{ models: { providerId: [id | { id }] } }` -> providers + modelCount.
   - Fall back to legacy `~/.cache/opencode/models.json` when omo cache is missing/unparseable
     (existing parsing kept as-is).
   - Keep custom-provider merge behavior in both paths; set `cachePath` to the file actually used.
4. `packages/omo-opencode/src/cli/doctor/checks/model-resolution-details.ts`: print the actual
   `available.cachePath` when present instead of hardcoded legacy path.

## Verification

- RED first: new tests in `model-resolution-cache.test.ts` reproducing the defect
  (provider-models.json present but doctor reported cacheExists:false). Save log.
- GREEN after fix. Focused: `bun test packages/omo-opencode/src/cli/doctor`.
- Gates x2 on final tree: focused bun test; `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`;
  `git diff --check`; hygiene grep (`as any|@ts-ignore|console.log`) no new hits.
- Real-surface QA in `/tmp/opencode/issue-6484/` with sandboxed XDG_CACHE_HOME/XDG_CONFIG_HOME/HOME:
  run real refresh-equivalent write then real doctor CLI; prove Models check healthy and that the
  real ~/.cache and ~/.omo are untouched.

## Constraints

No commit/push/PR. No `as any` / ts-ignore / non-null assertions. given/when/then tests.
Never stage packages/shared-skills/upstreams/* submodule churn. rg unavailable (use git grep).
