# Plan: Fix #6381 - update procedure misrecognises existing configuration

## Root cause

`packages/omo-opencode/src/cli/config-manager/detect-current-config.ts:115-116`:
`detectCurrentConfig()` initializes `hasClaude: true` / `isMax20: true` and never
overwrites them after parsing the OpenCode config. Only `hasGemini` (line 155,
`"google" in providers`) and the omo-config-derived flags get real detection.
Every existing install therefore reports `Claude=max20, Gemini=no` regardless of
the actual Anthropic configuration.

Consumers of `DetectedConfig.hasClaude/isMax20`: `detectedToInitialValues()`
(install-validators.ts:248) -> TUI prompt pre-selections + "Current config:"
display line. Non-TUI installs require explicit `--claude`, so detection only
drives pre-selections/display.

## Fix (single file)

In `detectCurrentConfig()`:

1. Change defaults `hasClaude`/`isMax20` to `false` (honest "nothing detected").
2. After a successful parse, detect Claude symmetrically with Gemini:
   - `"anthropic" in providers` (provider block), OR
   - `getProviderAuthType("anthropic") !== undefined` (auth.json credential;
     covers OAuth Pro/Max logins which never create a provider block).
   - `isMax20` stays `false`: subscription tier is not recorded on disk; TUI
     users re-confirm; non-TUI requires explicit `--claude=max20`.
3. Detection runs for any successfully parsed config (installed or not); the
   `format === "none"` and parse-failure paths keep all-false defaults.

Import `getProviderAuthType` via the existing `../../shared` barrel.

## Tests (failing first)

Co-located in `packages/omo-opencode/src/cli/config-manager/plugin-detection.test.ts`,
new describe `detectCurrentConfig - provider recognition`, given/when/then:

- existing install with only google provider (+ opencode-go/zen omo config, the
  issue scenario) -> hasClaude=false, isMax20=false, hasGemini=true
- anthropic provider entry -> hasClaude=true
- auth.json anthropic entry without provider block -> hasClaude=true
- no config file at all -> hasClaude=false
- issue-scenario mapping through `detectedToInitialValues` -> claude="no",
  gemini="yes"

## Verification

- RED capture before fix, GREEN after (scoped bun test files)
- `bun run typecheck` (tsgo)
- Honest OMITTED notes (no live TUI drive; pure fs/json logic covered by tests)

## Commit

`fix(cli): detect existing Anthropic/Gemini providers instead of assuming Claude=max20`
Staging ONLY: detect-current-config.ts, plugin-detection.test.ts, this evidence dir.
Never: shared-skills/upstreams/*, plugin build artifacts, pre-existing .omo drift.
