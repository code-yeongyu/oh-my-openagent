# WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/cli/config-manager/plugin-detection.test.ts`
- Surface: `detectCurrentConfig()` (`packages/omo-opencode/src/cli/config-manager/detect-current-config.ts`),
  the function that produces the `Existing configuration detected:` /
  `Current config: Claude=..., Gemini=...` values consumed by
  `detectedToInitialValues()` for TUI prompt pre-selections during install/update.
- Behavior meant to prove: an existing installation is recognized from real
  on-disk evidence (opencode.json[c] provider blocks + auth.json credentials)
  instead of hardcoded `hasClaude=true / isMax20=true` defaults.
- Regression suite: `bun test packages/omo-opencode/src/cli/ packages/omo-opencode/src/shared/opencode-provider-auth.test.ts`
- Typecheck: `bun run typecheck` (tsgo --noEmit root + script + all packages)

# WHAT WAS OBSERVED

## RED (before fix, see red-before-fix.txt)

3 failures, exactly the bug:

1. issue scenario (only google provider + opencode-go/zen omo config):
   `hasClaude` expected false, received true
2. anthropic provider entry present: `isMax20` expected false, received true
3. no opencode config at all: `hasClaude` expected false, received true

## GREEN (after fix, see green-after-fix.txt)

18 pass / 0 fail in plugin-detection.test.ts, including:

- issue #6381 scenario -> hasClaude=false, isMax20=false, hasGemini=true,
  hasOpencodeGo=true, hasOpencodeZen=true
- anthropic provider block -> hasClaude=true, isMax20=false
- auth.json `{ "anthropic": { "type": "oauth" } }` with NO provider block ->
  hasClaude=true (OAuth Pro/Max logins never create provider blocks)
- missing config file -> nothing claimed (all false)
- `detectedToInitialValues()` maps the issue scenario to claude="no",
  gemini="yes", opencodeGo="yes", opencodeZen="yes"

Isolation proof: tests run under the repo bunfig preload sandbox
(test-setup.ts) with HOME/OPENCODE_CONFIG_DIR redirected per-test; the
auth.json case additionally pins XDG_DATA_HOME to a temp dir and resets the
provider-auth mtime cache via `_resetProviderAuthCacheForTesting()`, so the
real `/home/<user>/.local/share/opencode/auth.json` is never read or written.
No opencode process was spawned; no session DB touched.

Scoped regression suite: 714 pass / 0 fail across 99 files.
Typecheck: exit 0 (see typecheck.txt).

# WHY IT IS ENOUGH

The fix is a pure detection-function change (fs + JSON parse, no network, no
async). The co-located given/when/then tests drive the exact exported function
the installer uses, cover every branch of the new logic (provider block,
auth.json credential, neither), pin the issue's end-user-visible mapping
through `detectedToInitialValues`, and went red-before/green-after. The scoped
suite covers all direct consumers (cli-installer, tui-installer,
install-validators, model-fallback, provider-availability). Remaining
regression risk is limited to interactive TUI rendering, which is unchanged
code.

# WHAT WAS OMITTED

- Live TUI/installer drive (`opencode-qa` full skill): omitted. The change adds
  no hook/tool/server surface; it only alters two boolean fields of a pure
  detection struct. The task contract scoped verification to failing-first
  unit tests + typecheck; recorded here honestly per AGENTS.md.
- `isMax20` tier detection: OpenCode stores no on-disk signal distinguishing
  Max 20x from standard subscriptions, so detected Claude now pre-selects
  "Yes (standard)" instead of "max20". TUI users re-confirm (one keystroke);
  non-TUI installs require explicit `--claude=max20`
  (validateNonTuiArgs, install-validators.ts:137-141).
- Fresh-install path (config parses but plugin not yet registered): Claude
  detection intentionally placed after the `isInstalled` gate, symmetric with
  the existing Gemini detection, keeping the diff minimal. Pre-fix behavior
  for that path was also wrong (always max20); fixing it would be a behavior
  change beyond this issue's scope.
- No secrets: fixtures use "[REDACTED]" placeholders; no real auth.json
  contents were copied anywhere.
