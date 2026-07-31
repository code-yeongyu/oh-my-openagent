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

## Why it is enough

The regression pins the exact missing-cache path and refresh guidance. The
related suites cover existing cache and custom-provider behavior. The real CLI
run proves the text survives command rendering with an isolated missing cache,
without reinterpreting OMO's separate `provider-models.json` schema.

## What was omitted

No credentials, tokens, auth headers, configuration contents, or environment
dumps were captured.
