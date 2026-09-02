# EVIDENCE - issue #6845 installer scope confirmation

Branch: issue/6845-installer-scope-confirm (base dev @8833800ae)
Scope: packages/omo-opencode/src/cli (installer only; doctor left to a linked follow-up per maintainer comment)

## WHAT WAS TESTED

1. Failing-first regression proof: reverted the salvaged behavior files and ran the new co-located suite
   `bun test packages/omo-opencode/src/cli/install.test.ts` against base behavior. Log: red-failing-first.log
2. Scoped unit gate after fix: `bun test packages/omo-opencode/src/cli/install.test.ts`. Log: green-scoped-tests.log
3. Repo typecheck gate: `bun run typecheck` (tsgo --noEmit + script + all 30 package tsconfigs). Log: typecheck.log
4. Live CLI surface probe of the new public flag:
   `bun packages/omo-opencode/src/cli/index.ts install --help` and
   `bun packages/omo-opencode/src/cli/index.ts install --config-scope=both --no-tui`. Log: cli-flag-probe.log

The regression tests drive the real `install()` entry with an isolated sandbox:
`OPENCODE_CONFIG_DIR` pointed at a fresh temp custom dir + `XDG_CONFIG_HOME` at a fresh temp dir,
so the default global root resolves inside the sandbox. No real user config is read or written;
env vars are restored and temp dirs removed in afterEach.

## WHAT WAS OBSERVED

- RED (before fix): 3 of 4 new tests fail on base behavior -
  (a) `--no-tui` without scope exits 0 and silently registers into the active custom dir (expected exit 1, no writes);
  (b) `--config-scope=global` still lands opencode.json in the custom dir (expected: default global root only);
  (c) unsupported value "both" exits 0 instead of being rejected.
  The active-scope case passes trivially because base behavior already wrote there.
- GREEN (after fix): 7 pass / 0 fail / 33 expect() calls.
  global scope -> `$XDG_CONFIG_HOME/opencode/opencode.json` + tui.json written, custom dir untouched;
  active scope -> `<OPENCODE_CONFIG_DIR>/opencode.json` + tui.json written, global root untouched;
  missing scope -> exit 1 before any mutation, error names both roots and the flag;
  invalid scope -> exit 1, nothing written.
- Typecheck: exit 0, no errors.
- CLI probe: help lists `--config-scope <scope>` with choices active|global;
  `--config-scope=both` rejected by Commander choices ("Allowed choices are active, global").

## WHY IT IS ENOUGH

- The four new tests pin every clause of the maintainer-confirmed contract that this patch owns:
  interactive prompt shows both paths and requires an explicit choice (promptInstallConfigScope),
  non-TUI fails fast without --config-scope, scoped registration lands in exactly one root with the
  other root untouched (no silent move/delete), and "both" is excluded at both Commander-choice and
  runtime-validation layers.
- Assertions check real filesystem state (which opencode.json/tui.json exist where), not log strings alone.
- Root cause of the residual failure found during verification: ensureTuiPluginEntry() resolved its own
  config dir via getOpenCodeConfigDir(), bypassing the scope override; both call sites now pass the
  override-aware getConfigDir(). This was caught by the global-scope tui.json assertion.
- resetConfigContext() now also clears the module-level configDirOverride, preventing cross-test leakage
  of a stale scope override.
- Remaining risk: doctor does not yet report both effective roots and docs are not updated; per the issue
  thread this may land in a linked patch, so this PR must not be treated as completing the whole issue
  beyond the installer contract + regression coverage delivered here.

## WHAT WAS OMITTED

- No secrets, tokens, or auth headers appear in any captured log; outputs contain only temp-dir paths.
- Full `bun test` root suite and live TUI interactive driving were not run: the change is confined to
  install-command code paths covered by the scoped suite; the TUI prompt path shares the same
  resolveDistinctConfigRoots/applyInstallConfigScope helpers verified here, and interactive @clack
  selection itself is not drivable headlessly without a tmux harness.
- Doctor dual-root reporting intentionally omitted (separate linked patch per issue discussion).
