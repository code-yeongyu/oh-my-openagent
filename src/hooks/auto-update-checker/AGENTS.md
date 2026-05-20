# src/hooks/auto-update-checker/ -- npm Update Detection

**Generated:** 2026-05-18

## OVERVIEW

27 files. Session Tier hook on `session.created`. Checks the npm registry for newer plugin versions, compares against the installed version, and surfaces update availability via startup toasts. Caches results to avoid repeated registry fetches. Throttled per channel (`latest`, `next`, `beta`). Skips CLI run mode and subagent sessions.

## FILE CATALOG

| File | Purpose |
|------|---------|
| `index.ts` | Barrel exports: hook factory, checker, cache invalidation, channel helpers |
| `hook.ts` | `createAutoUpdateCheckerHook()` -- event handler, orchestrates startup toasts and background check |
| `checker.ts` | Barrel for `checker/` subdir -- version resolution, local dev detection, package entry finding |
| `cache.ts` | `invalidatePackage()` -- removes package from bun.lock, node_modules, and specifier cache |
| `version-channel.ts` | `extractChannel()` -- resolves dist-tags and prerelease versions to npm channels |
| `types.ts` | `UpdateCheckResult`, `AutoUpdateCheckerOptions`, `NpmDistTags` |
| `constants.ts` | Registry URL, timeouts, cache paths, accepted package names |

## SUBDIRECTORIES

- `checker/` -- 11 files. Core version checking logic: `check-for-update.ts`, `latest-version.ts`, `local-dev-version.ts`, `plugin-entry.ts`, `cached-version.ts`, `pinned-version-updater.ts`, `sync-package-json.ts`, plus helpers.
- `hook/` -- 9 files. Startup UX: `background-update-check.ts`, `deferred-startup-check.ts`, `startup-toasts.ts`, `update-toasts.ts`, `spinner-toast.ts`, `config-errors-toast.ts`, `connected-providers-status.ts`, `model-capabilities-status.ts`, `model-cache-warning.ts`.

## CACHE

File-based deduplication via `VERSION_FILE` in the OpenCode cache directory (`getOpenCodeCacheDir()`). Prevents excessive npm registry calls. `invalidatePackage()` forces a fresh check by purging the package from Bun's lockfile, node_modules, and specifier cache.

## VERSION CHANNELS

`extractChannel()` maps:
- Dist-tags (`next`, `beta`) → channel name directly
- Prerelease versions (`1.0.0-beta.1`) → channel from prerelease prefix (`alpha`, `beta`, `rc`, `canary`, `next`)
- Stable versions → `latest`

## INTEGRATION

Registered in `create-session-hooks.ts` as `autoUpdateChecker`. Part of the Session Tier hook composition.

## RELATED

Three `zauc-mocks-*` directories in `src/hooks/` exist specifically to test this hook with mocked dependencies:
- `zauc-mocks-cache/` -- tests cache invalidation paths
- `zauc-mocks-hook/` -- tests hook orchestration with mocked submodules
- `zauc-mocks-bg/` -- tests background check scheduling

## CROSS-REFERENCES

- Parent: [`src/hooks/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/hooks/AGENTS.md) -- Session Tier hook list
- [`src/cli/AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/src/cli/AGENTS.md) -- CLI uses the same npm dist-tag helpers
