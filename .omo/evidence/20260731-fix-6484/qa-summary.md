# QA summary - issue #6484 - doctor cache guidance

Captured 2026-07-31 on Windows 11 with Bun 1.3.14.

## What was tested

- Regression before the fix:
  `bun test packages/omo-opencode/src/cli/doctor/checks/model-resolution-cache-guidance.test.ts`
- Regression and related suites after the fix:
  `bun test packages/omo-opencode/src/cli/doctor/checks/model-resolution-cache-guidance.test.ts packages/omo-opencode/src/cli/doctor/checks/model-resolution.test.ts packages/omo-opencode/src/cli/doctor/checks/model-resolution-cache.test.ts`
- Package typecheck:
  `bunx tsgo --noEmit -p packages/omo-opencode`
- Real CLI with an isolated empty `XDG_CACHE_HOME`:
  `bun packages/omo-opencode/src/cli/index.ts doctor`
- CLI help and invalid-option handling:
  `doctor --help`
  `doctor --not-a-real-option`

## What was observed

- Before the fix, the regression failed because the issue description was only
  `OpenCode model cache is missing, so model availability cannot be validated.`
  It did not contain the probed `models.json` path.
- After the fix, 26 related tests passed with 0 failures and the package
  typecheck exited 0 with no diagnostics.
- The real doctor CLI reported the exact isolated path:
  `C:\Users\pss\AppData\Local\Temp\omo-6484-after\cache\opencode\models.json`
- The fix text retained `opencode models --refresh`, instructed the user to
  verify that exact file, and explained that OpenCode core writes the cache.
- `doctor --help` listed the supported options and examples.
- `doctor --not-a-real-option` rejected the input with exit code 1.

## Mandated OpenCode QA (2026-08-03, added after review)

The first evidence round recorded Bun tests, a typecheck, and direct execution of the
TypeScript doctor entrypoint. Review correctly ruled that this does not satisfy the
AGENTS.md requirement (L15-L18) for a real `opencode-qa` harness case with before/after
blast radius and an isolation proof. That case is now recorded.

`live-doctor-opencode-qa.ps1` drives the REAL routed CLI
(`bun packages/omo-opencode/src/cli/index.ts doctor --json`) inside an isolated XDG sandbox
with `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` / `XDG_STATE_HOME` all pointed at
temp dirs (the convention in `.agents/skills/opencode-qa/scripts/lib/common.sh`), and proves
the developer's real `~/.local/share/opencode/opencode.db` was untouched by comparing
`SELECT count(*) FROM session` before and after, per AGENTS.md L18.

BEFORE, on pristine `upstream/dev` with only the product file reverted
(`live-doctor-before.txt`):

```text
  issue.description : OpenCode model cache is missing, so model availability cannot be validated.
  issue.fix         : Run: opencode models --refresh
  sessions before: 2831 -> sessions after: 2831   count unchanged: True
  RESULT: PASS
```

AFTER, on this branch (`live-doctor-after.txt`):

```text
  issue.description : OpenCode model cache is missing at <SANDBOX>\cache\opencode\models.json, so model availability cannot be validated.
  issue.fix         : Run: opencode models --refresh, then verify <SANDBOX>\cache\opencode\models.json. If it is still missing, update or report OpenCode because OpenCode core writes this cache.
  sessions before: 2831 -> sessions after: 2831   count unchanged: True
  RESULT: PASS
```

Both runs exit 0 with the real session count unchanged, so the change is proven through the
routed CLI without writing to the live OpenCode DB. The session count is deliberately read
outside the sandbox: with `XDG_DATA_HOME` still redirected, `opencode db` resolves the sandbox
database and reports 0 rather than the real count.

## Test isolation defect found in review (fixed)

`model-resolution-cache-guidance.test.ts` isolated `XDG_CACHE_HOME` but not
`XDG_CONFIG_HOME`. `loadAvailableModelsFromCache()` returns `cacheExists: true` when
`models.json` is absent but a config defines any custom provider
(`model-resolution-cache.ts` L51-56), and `getUserConfigDir()` reads `XDG_CONFIG_HOME` first
(L7-11), so the test outcome depended on the environment it ran in.

The review's stated trigger (an unset `XDG_CONFIG_HOME` falling back to the developer's real
`~/.config/opencode`) does not reproduce here, because `test-setup.ts` points `HOME` and
`USERPROFILE` at a hermetic temp home. The underlying defect is real for the case that setup
deliberately does not cover - it states "Deliberately NOT setting XDG_*" - so a set
`XDG_CONFIG_HOME`, which is normal on Linux and in CI, reaches a real config:

```text
RED  (XDG_CONFIG_HOME -> a config with provider.google)
  expect(issue?.description).toContain(expectedCacheFile)
  error: Received value must be an array type, or both received and expected values must be strings.
  0 pass / 1 fail
GREEN (same polluted XDG_CONFIG_HOME, after isolating it in the test)   1 pass / 0 fail
GREEN (XDG_CONFIG_HOME unset, developer default)                        1 pass / 0 fail
```

Recorded in `green-xdg-isolation-20260803.txt`. The test now points `XDG_CONFIG_HOME` at an
empty temp config dir and restores the original in `afterEach`.

Regression: the full `packages/omo-opencode/src/cli/doctor/` directory is 162 pass / 0 fail on
this branch and 161 pass / 0 fail on pristine dev (the difference is this test), recorded in
`doctor-suite-20260803.txt` and `baseline-doctordir-preexisting.txt`. An intermittent
`spawnWithTimeout` failure seen in two earlier directory runs passes 8/0 in isolation both with
this change and on pristine dev (`baseline-spawn-preexisting.txt`), and the directory run is
clean on both, so it is environmental. `bun run typecheck:packages` exits 0
(`typecheck-20260803.txt`).

## Why it is enough

The regression pins the exact missing-cache path and refresh guidance. The
related suites cover existing cache and custom-provider behavior. The real CLI
run proves the text survives command rendering with an isolated missing cache,
without reinterpreting OMO's separate `provider-models.json` schema.

## What was omitted

No credentials, tokens, auth headers, configuration contents, or environment
dumps were captured.
