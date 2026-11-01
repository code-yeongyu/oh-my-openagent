# Issue #6484: doctor "Model cache not found" persists after refresh

Branch: `fix/6484-doctor-model-cache-path` (base `origin/dev` @ 8c57e463e). No commit/push/PR per lane mandate.

## Root cause

`loadAvailableModelsFromCache()` in
`packages/omo-opencode/src/cli/doctor/checks/model-resolution-cache.ts` read ONLY
`~/.cache/opencode/models.json`. Repo-wide grep proves no code path writes that file.
The cache actually written by `opencode models --refresh` and plugin startup is
`~/.cache/oh-my-opencode/provider-models.json` (`updateConnectedProvidersCache()` ->
`createJsonFileCacheStore`, filename const in `shared/connected-providers-cache.ts`).
Runtime (`shared/model-availability.ts`) already preferred the omo cache with legacy
fallback; the doctor never did, so stock users always hit `cacheExists: false`.

## Fix (issue option 1 + maintainer mid-term suggestion)

1. `shared/connected-providers-cache.ts`: export `PROVIDER_MODELS_CACHE_FILE` /
   `CONNECTED_PROVIDERS_CACHE_FILE` (single source of truth for filenames).
2. `doctor/checks/model-resolution-types.ts`: optional `cachePath?: string` on `AvailableModelsInfo`.
3. `doctor/checks/model-resolution-cache.ts`: read omo `provider-models.json` first
   (reshape `{models:{provider:[id|{id}]}}` -> providers/modelCount), fall back to legacy
   `models.json`; malformed legacy keeps exact pre-fix semantics (`cacheExists:false`);
   custom-provider merge preserved on all usable paths; `cachePath` reports the file used.
4. `doctor/checks/model-resolution-details.ts`: print actual `available.cachePath`.

Diffstat: 5 files, +186/-17.

## TDD evidence

- `red-test.log`: 3 new tests failing pre-fix (cacheExists false despite refreshed cache;
  no omo-over-legacy preference; no cachePath).
- `green-test.log`: focused doctor suite 174 pass / 0 fail post-fix.
- New preservation-pin test: malformed-only legacy cache still reports no cache (pre-fix semantics).

## Gates (twice consecutively over identical final tree)

`gates-run-A.log`, `gates-run-B.log`: focused `bun test packages/omo-opencode/src/cli/doctor`
174 pass; `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` exit 0;
`git diff --check` clean; hygiene grep (`as any|@ts-ignore|@ts-expect-error|console.log`)
no new hits.

## Real-surface QA (isolated)

Sandbox: `/tmp/opencode/issue-6484/sandbox` with private HOME/XDG_CACHE_HOME/XDG_CONFIG_HOME/
XDG_DATA_HOME/XDG_STATE_HOME; real doctor CLI run from source
(`bun packages/omo-opencode/src/cli/index.ts doctor`).

- `qa-doctor-baseline-no-cache.txt`: empty sandbox reproduces "Model cache not found".
- `qa-refresh-writer-run.txt`: production writer `writeProviderModelsCache()` writes sandbox
  `oh-my-opencode/provider-models.json` (exact refresh-write path, realistic payload).
- `qa-doctor-after-refresh.txt|.json`: Models check -> **pass** ("11 agents, 8 categories,
  17 overrides"), details show `Cache: <sandbox>/oh-my-opencode/provider-models.json`,
  "Model cache not found" gone. Unrelated environmental noise: Tools warn (gh auth),
  System fail (plugin not registered in sandbox), Config warn (repo .omo overrides reference
  deepseek absent from sandbox cache - validation working as designed).
- Isolation: real `~/.cache/oh-my-opencode/*` + `~/.cache/opencode` digests unchanged
  (`qa-isolation-before/after.txt`); real `~/.omo` unchanged by doctor QA
  (`qa-isolation-omo-proof.txt`; only ambient host codegraph daemon log churned, excluded).

## Self-audit state machine

Wave 1 (finding wave): W1-1 P1 generated `install-local.mjs` churn from killed bun install ->
restored; W1-2 P2 legacy-malformed semantic delta -> fixed via discriminated read + pin test;
W1-3/W1-4 P3 noise adjudicated keep. Waves 2+3: zero findings each (fresh diff re-read,
adjacent callers/type consumers/filename single-source verified) -> clean_streak=2 after final edit.
